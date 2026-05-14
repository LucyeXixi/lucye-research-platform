#!/usr/bin/env python3
"""
Enrich LetPub journal records with easyScholar rank data.

Reads data/journals.json and writes data/journals_merged.json without modifying
the source file. The script is resumable through data/done_issns.txt and a
partial merged output file.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

import requests
from requests.exceptions import SSLError
from urllib3.exceptions import InsecureRequestWarning


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
INPUT_PATH = DATA_DIR / "journals.json"
OUTPUT_PATH = DATA_DIR / "journals_merged.json"
DONE_PATH = DATA_DIR / "done_issns.txt"
FAILED_PATH = DATA_DIR / "easyscholar_failed.txt"
CONFLICTS_PATH = DATA_DIR / "conflicts.txt"
REPORT_PATH = DATA_DIR / "easyscholar_report.json"

API_URL = os.environ.get("EASYSCHOLAR_API_URL", "https://easyscholar.cc/open/getPublicationRank")
DEFAULT_SECRET_KEY = "b847c6c5e3ca4b57a12fa7b6e5760130"
DEFAULT_TIMEOUT = 30


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value).replace("\xa0", " ")).strip()


def normalize_issn(value: Any) -> str:
    text = clean_text(value).upper()
    match = re.search(r"\b\d{4}-[\dX]{4}\b", text)
    return match.group(0) if match else text


def record_key(record: dict[str, Any]) -> str:
    issn = normalize_issn(record.get("issn"))
    if issn:
        return issn
    name = clean_text(record.get("name"))
    return f"NAME:{name}" if name else f"IDX:{id(record)}"


def read_lines(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()}


def append_line(path: Path, value: str) -> None:
    with path.open("a", encoding="utf-8") as handle:
        handle.write(value + "\n")


def atomic_write_json(path: Path, data: Any) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def load_json_list(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError(f"{path} must contain a JSON list")
    return data


def load_base_records() -> list[dict[str, Any]]:
    if not INPUT_PATH.exists():
        raise FileNotFoundError(
            f"{INPUT_PATH} does not exist yet. Wait for the LetPub scraper to create it, then rerun."
        )
    return load_json_list(INPUT_PATH)


def load_working_records(base_records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not OUTPUT_PATH.exists():
        return base_records
    try:
        merged = load_json_list(OUTPUT_PATH)
    except Exception as exc:
        backup = OUTPUT_PATH.with_suffix(".json.bak")
        OUTPUT_PATH.replace(backup)
        print(f"[WARN] invalid existing merged JSON moved to {backup}: {exc}", flush=True)
        return base_records
    if len(merged) != len(base_records):
        print(
            f"[WARN] existing merged length {len(merged)} differs from input length {len(base_records)}; "
            "merging previous easyScholar results by ISSN/name",
            flush=True,
        )
        previous_by_key = {
            record_key(record): record.get("easy_scholar")
            for record in merged
            if isinstance(record, dict) and record.get("easy_scholar")
        }
        for record in base_records:
            previous = previous_by_key.get(record_key(record))
            if previous:
                record["easy_scholar"] = previous
        return base_records
    return merged


def find_nested_values(obj: Any, key_names: set[str]) -> list[Any]:
    found: list[Any] = []
    if isinstance(obj, dict):
        for key, value in obj.items():
            if str(key) in key_names:
                found.append(value)
            found.extend(find_nested_values(value, key_names))
    elif isinstance(obj, list):
        for item in obj:
            found.extend(find_nested_values(item, key_names))
    return found


def first_nested(obj: Any, key_names: set[str]) -> Any:
    values = find_nested_values(obj, key_names)
    return values[0] if values else None


def unwrap_payload(response_json: Any) -> Any:
    if not isinstance(response_json, dict):
        return response_json
    for key in ("data", "result", "publication", "publicationRank", "publication_rank"):
        value = response_json.get(key)
        if value not in (None, "", [], {}):
            return value
    return response_json


def is_successful_payload(response_json: Any) -> bool:
    if response_json in (None, "", [], {}):
        return False
    if not isinstance(response_json, dict):
        return True
    code = response_json.get("code")
    if code is not None and str(code) not in {"0", "200", "success", "SUCCESS"}:
        # Some APIs use nonzero code for quota/auth/no-result conditions.
        return False
    payload = unwrap_payload(response_json)
    return payload not in (None, "", [], {})


def parse_bool(value: Any) -> bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = clean_text(value).lower()
    if text in {"true", "yes", "y", "1", "是", "top", "oa", "open access"}:
        return True
    if text in {"false", "no", "n", "0", "否", "非", "closed", "not oa", "none"}:
        return False
    if "hybrid" in text or "open" in text or "oa" in text:
        return True
    if "closed" in text or "非oa" in text:
        return False
    return None


def parse_tier(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, dict):
        for key in ("rank", "tier", "zone", "value", "分区"):
            parsed = parse_tier(value.get(key))
            if parsed:
                return parsed
        text = json.dumps(value, ensure_ascii=False)
    else:
        text = clean_text(value)
    match = re.search(r"([1-4])\s*(?:区|quartile|tier|zone)?", text, flags=re.I)
    return int(match.group(1)) if match else None


def parse_jcr(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, dict):
        for key in ("jcrQ", "jcr", "q", "quartile", "value"):
            parsed = parse_jcr(value.get(key))
            if parsed:
                return parsed
        text = json.dumps(value, ensure_ascii=False)
    else:
        text = clean_text(value)
    match = re.search(r"\bQ([1-4])\b", text, flags=re.I)
    return f"Q{match.group(1)}" if match else None


def normalize_easy_scholar(response_json: Any) -> dict[str, Any]:
    payload = unwrap_payload(response_json)
    sci_up = first_nested(payload, {"sciUp", "sci_up", "sciUpgrade", "中科院升级版"})
    sci_base = first_nested(payload, {"sciBase", "sci_base", "中科院基础版"})
    jcr_q = first_nested(payload, {"jcrQ", "jcr", "jcrZone", "JCR"})
    is_top = first_nested(payload, {"isTop", "top", "is_top"})
    open_access = first_nested(payload, {"openAccess", "oa", "isOA", "open_access"})

    cas_tier = parse_tier(sci_up) or parse_tier(sci_base)
    return {
        "cas_tier": cas_tier,
        "cas_top": parse_bool(is_top),
        "jcr": parse_jcr(jcr_q),
        "oa": parse_bool(open_access),
        "matched": bool(is_successful_payload(response_json) and (cas_tier or parse_jcr(jcr_q))),
    }


class EasyScholarClient:
    def __init__(self, secret_key: str, delay: float, timeout: int = DEFAULT_TIMEOUT) -> None:
        self.secret_key = secret_key
        self.delay = delay
        self.timeout = timeout
        self.last_request_at = 0.0
        self.session = requests.Session()

    def wait(self) -> None:
        elapsed = time.monotonic() - self.last_request_at
        wait_for = self.delay - elapsed
        if wait_for > 0:
            time.sleep(wait_for)

    def query(self, publication_name: str, retries: int = 3) -> Any:
        last_error: Exception | None = None
        for attempt in range(1, retries + 1):
            self.wait()
            try:
                response = self.session.get(
                    API_URL,
                    params={"secretKey": self.secret_key, "publicationName": publication_name},
                    timeout=self.timeout,
                    headers={"User-Agent": "research-platform-easyscholar-enricher/1.0"},
                )
                self.last_request_at = time.monotonic()
                if response.status_code == 429:
                    print(f"[WARN] 429 from easyScholar; sleeping 30s ({attempt}/{retries})", flush=True)
                    if attempt < retries:
                        time.sleep(30)
                        continue
                response.raise_for_status()
                try:
                    return response.json()
                except ValueError:
                    return {"code": "non_json", "raw": response.text[:500]}
            except SSLError as exc:
                self.last_request_at = time.monotonic()
                last_error = exc
                if attempt == 1:
                    print(
                        f"[WARN] SSL failed for {publication_name!r}; retrying once with certificate "
                        "verification disabled",
                        flush=True,
                    )
                    requests.packages.urllib3.disable_warnings(category=InsecureRequestWarning)
                    self.wait()
                    response = self.session.get(
                        API_URL,
                        params={"secretKey": self.secret_key, "publicationName": publication_name},
                        timeout=self.timeout,
                        headers={"User-Agent": "research-platform-easyscholar-enricher/1.0"},
                        verify=False,
                    )
                    self.last_request_at = time.monotonic()
                    if response.status_code == 429:
                        print("[WARN] 429 from easyScholar; sleeping 30s", flush=True)
                        time.sleep(30)
                        continue
                    response.raise_for_status()
                    try:
                        return response.json()
                    except ValueError:
                        return {"code": "non_json", "raw": response.text[:500]}
                if attempt < retries:
                    time.sleep(5 * attempt)
            except Exception as exc:
                self.last_request_at = time.monotonic()
                last_error = exc
                if attempt < retries:
                    sleep_for = 30 if "429" in str(exc) else 5 * attempt
                    print(
                        f"[WARN] easyScholar query failed for {publication_name!r}: {exc}; "
                        f"sleeping {sleep_for}s ({attempt}/{retries})",
                        flush=True,
                    )
                    time.sleep(sleep_for)
        raise RuntimeError(f"easyScholar failed for {publication_name!r}: {last_error}")


def query_record(client: EasyScholarClient, record: dict[str, Any]) -> tuple[dict[str, Any], str, Any | None]:
    issn = normalize_issn(record.get("issn"))
    name = clean_text(record.get("name"))
    attempts = [item for item in (issn, name) if item]
    raw_response = None
    for idx, query in enumerate(attempts):
        raw_response = client.query(query)
        enriched = normalize_easy_scholar(raw_response)
        if enriched["matched"]:
            return enriched, query, raw_response
        if idx == 0 and len(attempts) > 1:
            print(f"[INFO] no easyScholar match by ISSN {issn}; retrying by name {name}", flush=True)
    return {
        "cas_tier": None,
        "cas_top": None,
        "jcr": None,
        "oa": None,
        "matched": False,
    }, attempts[-1] if attempts else "", raw_response


def letpub_cas_tier(record: dict[str, Any]) -> int | None:
    cas = record.get("cas_2025")
    if isinstance(cas, dict):
        value = cas.get("tier")
        return int(value) if isinstance(value, int) or str(value).isdigit() else None
    return None


def letpub_top(record: dict[str, Any]) -> bool | None:
    cas = record.get("cas_2025")
    if isinstance(cas, dict) and isinstance(cas.get("top"), bool):
        return cas["top"]
    return None


def normalize_oa_text(value: Any) -> bool | None:
    if value == "Hybrid":
        return True
    return parse_bool(value)


def conflict_lines(records: list[dict[str, Any]]) -> list[str]:
    lines = [
        "key\tname\tfield\tletpub\teasy_scholar\tletpub_url",
    ]
    for record in records:
        easy = record.get("easy_scholar") or {}
        if not easy.get("matched"):
            continue
        key = record_key(record)
        name = clean_text(record.get("name"))
        url = clean_text(record.get("letpub_url"))

        comparisons = {
            "cas_tier": (letpub_cas_tier(record), easy.get("cas_tier")),
            "cas_top": (letpub_top(record), easy.get("cas_top")),
            "jcr": (clean_text(record.get("jcr")) or None, easy.get("jcr")),
            "oa": (normalize_oa_text(record.get("open_access")), easy.get("oa")),
        }
        for field, (left, right) in comparisons.items():
            if left is None or right is None or left == "":
                continue
            if left != right:
                lines.append(f"{key}\t{name}\t{field}\t{left}\t{right}\t{url}")
    return lines


def write_conflicts(records: list[dict[str, Any]]) -> int:
    lines = conflict_lines(records)
    CONFLICTS_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return max(0, len(lines) - 1)


def write_report(records: list[dict[str, Any]], failed: set[str], conflict_count: int) -> dict[str, Any]:
    total = len(records)
    matched = sum(1 for record in records if (record.get("easy_scholar") or {}).get("matched"))
    report = {
        "total": total,
        "matched": matched,
        "matched_rate": round(matched / total, 4) if total else 0,
        "failed_count": len(failed),
        "conflict_count": conflict_count,
        "output_path": str(OUTPUT_PATH),
        "conflicts_path": str(CONFLICTS_PATH),
    }
    atomic_write_json(REPORT_PATH, report)
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Enrich journals.json with easyScholar API data")
    parser.add_argument("--secret-key", default=os.environ.get("EASYSCHOLAR_SECRET_KEY", DEFAULT_SECRET_KEY))
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--max-records", type=int, default=None, help="For smoke testing only")
    parser.add_argument("--checkpoint-every", type=int, default=50)
    args = parser.parse_args()

    if args.delay < 1.0:
        raise SystemExit("delay must be at least 1.0 second")

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    records = load_working_records(load_base_records())
    done = read_lines(DONE_PATH)
    failed = read_lines(FAILED_PATH)
    client = EasyScholarClient(args.secret_key, args.delay)

    pending_indexes = [
        idx for idx, record in enumerate(records)
        if record_key(record) not in done or "easy_scholar" not in record
    ]
    if args.max_records is not None:
        pending_indexes = pending_indexes[: args.max_records]
    print(f"[INFO] pending {len(pending_indexes)} / total {len(records)}", flush=True)

    completed_this_run = 0
    for position, idx in enumerate(pending_indexes, start=1):
        record = records[idx]
        key = record_key(record)
        try:
            easy, query, _raw = query_record(client, record)
            record["easy_scholar"] = easy
            done.add(key)
            failed.discard(key)
            append_line(DONE_PATH, key)
            completed_this_run += 1
            print(
                f"[ENRICH] {position}/{len(pending_indexes)} {key} matched={easy['matched']} query={query!r}",
                flush=True,
            )
        except Exception as exc:
            failed.add(key)
            append_line(FAILED_PATH, key)
            record["easy_scholar"] = {
                "cas_tier": None,
                "cas_top": None,
                "jcr": None,
                "oa": None,
                "matched": False,
            }
            print(f"[WARN] failed {key}: {exc}", flush=True)

        if completed_this_run and completed_this_run % args.checkpoint_every == 0:
            atomic_write_json(OUTPUT_PATH, records)
            FAILED_PATH.write_text("\n".join(sorted(failed)) + "\n", encoding="utf-8")
            print(f"[CHECKPOINT] wrote {OUTPUT_PATH} after {completed_this_run} completed", flush=True)

    atomic_write_json(OUTPUT_PATH, records)
    FAILED_PATH.write_text("\n".join(sorted(failed)) + "\n", encoding="utf-8")
    conflict_count = write_conflicts(records)
    report = write_report(records, failed, conflict_count)
    if report["matched_rate"] < 0.8:
        print("[WARN] matched rate is below the requested 80% threshold", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\n[STOP] interrupted by user", file=sys.stderr)
        raise SystemExit(130)
