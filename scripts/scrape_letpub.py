#!/usr/bin/env python3
"""
Polite, resumable LetPub SCI journal scraper.

The scraper obeys robots.txt, stays serial, sleeps between every HTTP request,
checkpoints data every 50 successful details, and retries failed journal IDs
once at the end.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
from collections import OrderedDict
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Iterable
from urllib.parse import parse_qs, urlencode, urljoin, urlparse, urlunparse
from urllib.robotparser import RobotFileParser

import requests
from bs4 import BeautifulSoup

try:
    from fake_useragent import UserAgent
except Exception:  # pragma: no cover - dependency fallback
    UserAgent = None


BASE_URL = "https://www.letpub.com.cn/"
JOURNALAPP_URL = urljoin(BASE_URL, "index.php?page=journalapp")
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_PATH = DATA_DIR / "journals.json"
DONE_IDS_PATH = DATA_DIR / "done_ids.txt"
FAILED_IDS_PATH = DATA_DIR / "failed_ids.txt"
JOURNAL_IDS_PATH = DATA_DIR / "journal_ids.txt"
REPORT_PATH = DATA_DIR / "scrape_report.json"
SCRAPED_AT = os.environ.get("SCRAPED_AT", date.today().isoformat())

FALLBACK_UAS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/123.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0 Safari/537.36",
]


@dataclass
class FetchResult:
    url: str
    text: str
    status_code: int


class PoliteSession:
    def __init__(
        self,
        delay_min: float,
        delay_max: float,
        timeout: int = 45,
        soft_rate_limit_sleep: int = 3600,
    ) -> None:
        self.session = requests.Session()
        self.delay_min = delay_min
        self.delay_max = delay_max
        self.timeout = timeout
        self.soft_rate_limit_sleep = soft_rate_limit_sleep
        self.last_request_at = 0.0
        self.ua = UserAgent() if UserAgent else None

    def user_agent(self) -> str:
        if self.ua:
            try:
                return self.ua.random
            except Exception:
                pass
        return random.choice(FALLBACK_UAS)

    def wait_turn(self) -> None:
        if self.last_request_at <= 0:
            return
        elapsed = time.monotonic() - self.last_request_at
        wait_for = random.uniform(self.delay_min, self.delay_max) - elapsed
        if wait_for > 0:
            time.sleep(wait_for)

    def get(self, url: str, *, retries: int = 3) -> FetchResult:
        last_error: Exception | None = None
        for attempt in range(1, retries + 1):
            self.wait_turn()
            headers = {
                "User-Agent": self.user_agent(),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "Connection": "close",
            }
            try:
                resp = self.session.get(url, headers=headers, timeout=self.timeout)
                self.last_request_at = time.monotonic()
                if resp.status_code in {403, 429}:
                    print(
                        f"[WARN] {resp.status_code} for {url}; sleeping 60s "
                        f"before retry {attempt}/{retries}",
                        flush=True,
                    )
                    if attempt < retries:
                        time.sleep(60)
                        continue
                resp.raise_for_status()
                resp.encoding = resp.apparent_encoding or "utf-8"
                if self.is_soft_rate_limited(resp.text):
                    print(
                        f"[WARN] LetPub soft rate limit page for {url}; sleeping "
                        f"{self.soft_rate_limit_sleep}s before retry {attempt}/{retries}",
                        flush=True,
                    )
                    if attempt < retries:
                        time.sleep(self.soft_rate_limit_sleep)
                        continue
                    raise RuntimeError("LetPub soft rate limit page returned")
                return FetchResult(resp.url, resp.text, resp.status_code)
            except Exception as exc:
                self.last_request_at = time.monotonic()
                last_error = exc
                if attempt < retries:
                    sleep_for = 60 if "429" in str(exc) or "403" in str(exc) else min(30, 10 * attempt)
                    print(
                        f"[WARN] request failed for {url}: {exc}; sleeping {sleep_for}s "
                        f"before retry {attempt}/{retries}",
                        flush=True,
                    )
                    time.sleep(sleep_for)
        raise RuntimeError(f"failed after {retries} attempts: {url}: {last_error}")

    @staticmethod
    def is_soft_rate_limited(text: str) -> bool:
        return "请求页面的速度过快" in text or "请求期刊信息系统页面数据过于频繁" in text


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", value.replace("\xa0", " ")).strip()


def parse_float(value: str | None) -> float | None:
    if not value:
        return None
    match = re.search(r"(?<![\d.])(\d+(?:\.\d+)?)(?![\d.])", value.replace(",", ""))
    return float(match.group(1)) if match else None


def parse_int(value: str | None) -> int | None:
    if not value:
        return None
    match = re.search(r"(?<![\d.])(\d{1,9})(?![\d.])", value.replace(",", ""))
    return int(match.group(1)) if match else None


def parse_percent(value: str | None) -> float | None:
    if not value:
        return None
    match = re.search(r"(\d+(?:\.\d+)?)\s*%", value)
    return round(float(match.group(1)) / 100, 6) if match else None


def normalize_issn(value: str | None) -> str:
    if not value:
        return ""
    match = re.search(r"\b\d{4}-[\dXx]{4}\b", value)
    return match.group(0).upper() if match else ""


def read_id_set(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()}


def write_id_set(path: Path, ids: Iterable[str]) -> None:
    path.write_text("\n".join(sorted(set(ids), key=lambda x: int(x) if x.isdigit() else x)) + "\n", encoding="utf-8")


def append_id(path: Path, journal_id: str) -> None:
    with path.open("a", encoding="utf-8") as handle:
        handle.write(f"{journal_id}\n")


def atomic_write_json(path: Path, data: object) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def parse_journal_id_from_url(url: str) -> str | None:
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    if "journalid" in query and query["journalid"]:
        return query["journalid"][0]
    match = re.search(r"journalid=(\d+)", url)
    return match.group(1) if match else None


def load_existing_records() -> OrderedDict[str, dict]:
    records: OrderedDict[str, dict] = OrderedDict()
    if not OUTPUT_PATH.exists():
        return records
    try:
        data = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        backup = OUTPUT_PATH.with_suffix(".json.bak")
        OUTPUT_PATH.replace(backup)
        print(f"[WARN] invalid existing JSON moved to {backup}", flush=True)
        return records
    for item in data if isinstance(data, list) else []:
        jid = parse_journal_id_from_url(str(item.get("letpub_url", "")))
        if jid:
            records[jid] = item
    return records


def build_url(params: dict[str, str]) -> str:
    return f"{BASE_URL}index.php?{urlencode(params)}"


def extract_categories(main_html: str) -> list[tuple[str, list[str]]]:
    soup = BeautifulSoup(main_html, "lxml")
    majors: list[str] = []
    select = soup.select_one("#searchcategory1")
    if select:
        for option in select.find_all("option"):
            value = clean_text(option.get("value") or option.get_text())
            if value and value != "不限":
                majors.append(value)

    sub_map: dict[str, list[str]] = {}
    cats = dict(re.findall(r'categorycnarray\[(\d+)\]\s*=\s*"([^"]*)"', main_html))
    subs = dict(re.findall(r'subcategorycnarray\[(\d+)\]\s*=\s*"([^"]*)"', main_html))
    for idx, major in cats.items():
        if major:
            sub_map[major] = [item for item in subs.get(idx, "").split(";") if item]

    if not majors:
        majors = list(sub_map.keys())
    return [(major, sub_map.get(major, [])) for major in majors]


def is_allowed(rp: RobotFileParser, url: str) -> bool:
    return rp.can_fetch("*", url)


def load_robots(session: PoliteSession) -> RobotFileParser:
    robots_url = urljoin(BASE_URL, "robots.txt")
    result = session.get(robots_url)
    rp = RobotFileParser()
    rp.set_url(robots_url)
    rp.parse(result.text.splitlines())
    for url in (JOURNALAPP_URL, build_url({"journalid": "8411", "page": "journalapp", "view": "detail"})):
        if not is_allowed(rp, url):
            raise RuntimeError(f"robots.txt disallows target path: {url}")
    print("[INFO] robots.txt checked: journalapp paths are allowed", flush=True)
    return rp


def detail_url(journal_id: str) -> str:
    return build_url({"journalid": journal_id, "page": "journalapp", "view": "detail"})


def search_url(major: str, subcategory: str = "") -> str:
    return build_url(
        {
            "page": "journalapp",
            "view": "search",
            "searchname": "",
            "searchissn": "",
            "searchfield": "",
            "searchimpactlow": "",
            "searchimpacthigh": "",
            "searchimpacttrend": "",
            "searchscitype": "",
            "searchcategory1": major,
            "searchcategory2": subcategory,
            "searchjcrkind": "",
            "searchopenaccess": "",
            "searchsort": "relevance",
        }
    )


def normalize_search_link(href: str, current_url: str) -> str | None:
    if not href or href.startswith("javascript:"):
        return None
    full = urljoin(current_url, href)
    parsed = urlparse(full)
    if "letpub.com.cn" not in parsed.netloc:
        return None
    query = parse_qs(parsed.query)
    if query.get("page", [""])[0] != "journalapp" or query.get("view", [""])[0] != "search":
        return None
    if "journalid" in query:
        return None
    return urlunparse(parsed._replace(fragment=""))


def add_currentpage(url: str, page_no: int) -> str:
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    query["currentpage"] = [str(page_no)]
    flat = [(key, value) for key, values in query.items() for value in values]
    return urlunparse(parsed._replace(query=urlencode(flat), fragment=""))


def parse_index_page(html: str, current_url: str) -> tuple[set[str], set[str]]:
    ids = set(re.findall(r"journalid=(\d+)[^\"'>]*page=journalapp[^\"'>]*view=detail", html))
    ids.update(re.findall(r"page=journalapp[^\"'>]*view=detail[^\"'>]*journalid=(\d+)", html))

    soup = BeautifulSoup(html, "lxml")
    page_links: set[str] = set()
    for anchor in soup.find_all("a", href=True):
        href = str(anchor.get("href"))
        normalized = normalize_search_link(href, current_url)
        if normalized:
            page_links.add(normalized)

    for page_no in re.findall(r"currentpage=(\d+)", html):
        page_links.add(add_currentpage(current_url, int(page_no)))
    for page_no in re.findall(r"(?:go|goto|turn)page\s*\(\s*(\d+)\s*\)", html, flags=re.I):
        page_links.add(add_currentpage(current_url, int(page_no)))
    return ids, page_links


def crawl_index_seed(
    session: PoliteSession,
    rp: RobotFileParser,
    seed_url: str,
    all_ids: set[str],
    max_pages_per_seed: int,
) -> None:
    seen_pages: set[str] = set()
    queue: list[str] = [seed_url]
    synthesized_page = 2
    no_new_synth_pages = 0

    while queue and len(seen_pages) < max_pages_per_seed:
        url = queue.pop(0)
        if url in seen_pages:
            continue
        if not is_allowed(rp, url):
            raise RuntimeError(f"robots.txt disallows index URL: {url}")
        seen_pages.add(url)
        try:
            result = session.get(url)
        except Exception as exc:
            print(f"[WARN] index page failed and will be skipped for now: {url}: {exc}", flush=True)
            continue
        ids, links = parse_index_page(result.text, result.url)
        before = len(all_ids)
        all_ids.update(ids)
        new_count = len(all_ids) - before
        print(f"[INDEX] {len(all_ids)} ids (+{new_count}) from {result.url}", flush=True)

        for link in sorted(links):
            if link not in seen_pages and link not in queue:
                queue.append(link)

        if not links and ids:
            # Some LetPub search pages expose pagination through JavaScript only.
            # Probe currentpage=N conservatively and stop after two pages add no IDs.
            next_url = add_currentpage(seed_url, synthesized_page)
            synthesized_page += 1
            if new_count == 0:
                no_new_synth_pages += 1
            else:
                no_new_synth_pages = 0
            if no_new_synth_pages < 2 and next_url not in seen_pages:
                queue.append(next_url)


def collect_journal_ids(
    session: PoliteSession,
    rp: RobotFileParser,
    categories: list[tuple[str, list[str]]],
    index_mode: str,
    max_pages_per_seed: int,
    major_filter: str = "",
) -> set[str]:
    all_ids: set[str] = set()
    seeds: list[str] = []
    if major_filter:
        pattern = re.compile(major_filter)
        categories = [(major, subs) for major, subs in categories if pattern.search(major)]
        if not categories:
            categories = [(major_filter, [])]
            print(
                f"[INDEX] no parsed category matched; using direct searchcategory1={major_filter!r}",
                flush=True,
            )
        print(
            f"[INDEX] filtered categories by {major_filter!r}: "
            f"{', '.join(major for major, _ in categories) or 'none'}",
            flush=True,
        )
    for major, subs in categories:
        seeds.append(search_url(major))
        if index_mode == "all":
            seeds.extend(search_url(major, sub) for sub in subs)

    for pos, seed in enumerate(seeds, start=1):
        print(f"[INDEX] seed {pos}/{len(seeds)}: {seed}", flush=True)
        try:
            crawl_index_seed(session, rp, seed, all_ids, max_pages_per_seed)
            write_id_set(JOURNAL_IDS_PATH, all_ids)
        except Exception as exc:
            print(f"[WARN] index seed failed: {seed}: {exc}", flush=True)
    if major_filter and not all_ids:
        raise RuntimeError(
            f"no journal IDs collected for major_filter={major_filter!r}; "
            "likely LetPub rate limiting or search parameter structure changed"
        )
    return all_ids


def label_value_rows(soup: BeautifulSoup) -> list[tuple[str, str, object]]:
    rows = []
    for tr in soup.find_all("tr"):
        cells = tr.find_all(["td", "th"], recursive=False)
        if len(cells) < 2:
            continue
        label = clean_text(cells[0].get_text(" ", strip=True))
        value = clean_text(" ".join(cell.get_text(" ", strip=True) for cell in cells[1:]))
        if label:
            rows.append((label, value, tr))
    return rows


def find_row(rows: list[tuple[str, str, object]], *needles: str) -> str:
    for label, value, _ in rows:
        if all(needle in label for needle in needles):
            return value
    return ""


def first_row_value_contains(rows: list[tuple[str, str, object]], *needles: str) -> str:
    for label, value, _ in rows:
        combined = f"{label} {value}"
        if all(needle in combined for needle in needles):
            return combined
    return ""


def parse_name_abbr(soup: BeautifulSoup, rows: list[tuple[str, str, object]]) -> tuple[str, str]:
    h1 = soup.find("h1")
    name = clean_text(h1.get_text(" ", strip=True).replace("期刊收藏夹", "")) if h1 else ""
    abbr = ""
    for label, _, tr in rows:
        if "期刊名字" not in label:
            continue
        cells = tr.find_all(["td", "th"], recursive=False)
        if len(cells) < 2:
            continue
        value_cell = cells[1]
        link = value_cell.find("a", href=re.compile(r"journalapp.*detail|detail.*journalid"))
        if link:
            name = clean_text(link.get_text(" ", strip=True))
        font = value_cell.find("font")
        if font:
            abbr = clean_text(font.get_text(" ", strip=True))
        if not abbr:
            lines = [
                clean_text(line)
                for line in value_cell.get_text("\n", strip=True).splitlines()
                if clean_text(line)
            ]
            for line in lines:
                if line and line != name and "JCR" not in line and "收录" not in line and not re.search(r"\d", line):
                    abbr = line
                    break
    return name, abbr


def parse_cas(rows: list[tuple[str, str, object]]) -> dict:
    preferred = None
    fallback = None
    for label, value, tr in rows:
        combined = f"{label} {value}"
        if "期刊分区表" in combined or "新锐期刊分区表" in combined:
            # The current top-level "new" table may contain historical 2025
            # tables in its value text. Prefer the row whose own label is 2025.
            if "2025" in label:
                preferred = (label, value, tr)
                break
            if fallback is None:
                fallback = (label, value, tr)
    entry = preferred or fallback
    result = {"major": "", "tier": None, "top": False, "review": False}
    if not entry:
        return result

    _, value, tr = entry
    # Prefer actual nested table cells when available.
    for sub_tr in tr.find_all("tr"):
        cells = [clean_text(c.get_text(" ", strip=True)) for c in sub_tr.find_all(["td", "th"], recursive=False)]
        if len(cells) >= 4 and re.search(r"[1-4]区", cells[0]):
            match = re.search(r"(.+?)\s*([1-4])区", cells[0])
            if match:
                result["major"] = clean_text(match.group(1))
                result["tier"] = int(match.group(2))
                result["top"] = "是" in cells[2]
                result["review"] = "是" in cells[3]
                return result

    text = clean_text(value)
    text = re.sub(r"期刊分区表.*?(?=大类学科|$)", "", text)
    match = re.search(r"大类学科.*?([\u4e00-\u9fffA-Za-z：、&\s]+?)\s*([1-4])区", text)
    if match:
        result["major"] = clean_text(match.group(1))
        result["tier"] = int(match.group(2))
    yn = re.findall(r"\b(是|否|N/A)\b", text)
    if yn:
        result["top"] = yn[0] == "是"
    if len(yn) > 1:
        result["review"] = yn[1] == "是"
    return result


def parse_open_access(value: str, coverage: str) -> str:
    combined = f"{value} {coverage}".lower()
    if "hybrid" in combined or "混合" in combined:
        return "Hybrid"
    if re.search(r"\b(no|否)\b", combined):
        return "Closed"
    if re.search(r"\b(yes|是)\b", combined) or "doaj" in combined or "open access" in combined:
        return "OA"
    return "Closed"


def parse_review_weeks(value: str) -> float | None:
    if not value:
        return None
    month = re.search(r"平均\s*(\d+(?:\.\d+)?)\s*个月", value)
    if month:
        return round(float(month.group(1)) * 4.345, 2)
    week = re.search(r"平均\s*(\d+(?:\.\d+)?)\s*(?:周|星期)", value)
    if week:
        return round(float(week.group(1)), 2)
    day = re.search(r"平均\s*(\d+(?:\.\d+)?)\s*天", value)
    if day:
        return round(float(day.group(1)) / 7, 2)
    return None


def parse_subjects(value: str) -> list[str]:
    if not value:
        return []
    value = re.sub(r"[-\s]+$", "", value)
    parts = re.split(r"[;；,，\n-]+", value)
    return [clean_text(part).strip("-") for part in parts if clean_text(part).strip("-")]


def parse_detail(html: str, journal_id: str, final_url: str) -> dict:
    soup = BeautifulSoup(html, "lxml")
    rows = label_value_rows(soup)
    name, abbr = parse_name_abbr(soup, rows)
    coverage = find_row(rows, "SCI期刊收录coverage")
    jcr_value = find_row(rows, "WOS期刊JCR分区") or first_row_value_contains(rows, "JIF分区")
    jcr_match = re.search(r"\bQ[1-4]\b", jcr_value)

    oa_value = find_row(rows, "是否OA开放访问") or find_row(rows, "OA期刊相关信息")
    apc_value = find_row(rows, "版面费") or find_row(rows, "APC")
    apc_match = re.search(r"\bUSD\s*([0-9][0-9,]*(?:\.\d+)?)", apc_value, flags=re.I)

    chinese_text = first_row_value_contains(rows, "中国", "占比")
    self_cite_value = find_row(rows, "自引率")
    latest_if_value = find_row(rows, "最新影响因子") or find_row(rows, "影响因子")

    return {
        "name": name,
        "abbr": abbr,
        "issn": normalize_issn(find_row(rows, "期刊ISSN")),
        "eissn": normalize_issn(find_row(rows, "EISSN") or find_row(rows, "eISSN") or find_row(rows, "电子ISSN")),
        "if_2024": parse_float(latest_if_value),
        "if_5year": parse_float(find_row(rows, "五年影响因子")),
        "cas_2025": parse_cas(rows),
        "jcr": jcr_match.group(0) if jcr_match else "",
        "review_weeks": parse_review_weeks(find_row(rows, "平均审稿速度")),
        "acceptance_rate": parse_percent(find_row(rows, "平均录用比例")),
        "apc_usd": float(apc_match.group(1).replace(",", "")) if apc_match else None,
        "open_access": parse_open_access(oa_value, coverage),
        "articles_per_year": parse_int(find_row(rows, "年文章数")),
        "chinese_ratio": parse_percent(chinese_text),
        "self_cite_rate": parse_percent(self_cite_value),
        "subject_areas": parse_subjects(find_row(rows, "涉及的研究方向")),
        "letpub_url": final_url or detail_url(journal_id),
        "scraped_at": SCRAPED_AT,
    }


def validate_record(record: dict) -> bool:
    return bool(record.get("name")) and bool(record.get("issn"))


def write_report(records: list[dict], failed_ids: set[str]) -> dict:
    total = len(records)
    fields = [
        "name",
        "abbr",
        "issn",
        "eissn",
        "if_2024",
        "if_5year",
        "cas_2025",
        "jcr",
        "review_weeks",
        "acceptance_rate",
        "apc_usd",
        "open_access",
        "articles_per_year",
        "chinese_ratio",
        "self_cite_rate",
        "subject_areas",
        "letpub_url",
        "scraped_at",
    ]

    def filled(item: dict, field: str) -> bool:
        value = item.get(field)
        if field == "cas_2025":
            return bool(value and value.get("major") and value.get("tier"))
        if isinstance(value, list):
            return len(value) > 0
        return value not in (None, "", {})

    fill_rates = {
        field: (round(sum(1 for item in records if filled(item, field)) / total, 4) if total else 0)
        for field in fields
    }
    report = {
        "scraped_at": SCRAPED_AT,
        "total": total,
        "field_fill_rates": fill_rates,
        "failed_id_count": len(failed_ids),
        "failed_ids": sorted(failed_ids, key=lambda x: int(x) if x.isdigit() else x),
        "output_path": str(OUTPUT_PATH),
    }
    atomic_write_json(REPORT_PATH, report)
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
    return report


def checkpoint(records_by_id: OrderedDict[str, dict], done_ids: set[str], failed_ids: set[str]) -> None:
    atomic_write_json(OUTPUT_PATH, list(records_by_id.values()))
    write_id_set(DONE_IDS_PATH, done_ids)
    write_id_set(FAILED_IDS_PATH, failed_ids)
    print(
        f"[CHECKPOINT] wrote {len(records_by_id)} records, "
        f"{len(done_ids)} done ids, {len(failed_ids)} failed ids",
        flush=True,
    )


def scrape_details(
    session: PoliteSession,
    rp: RobotFileParser,
    ids: list[str],
    records_by_id: OrderedDict[str, dict],
    done_ids: set[str],
    failed_ids: set[str],
    *,
    max_details: int | None = None,
    detail_retries: int = 3,
) -> None:
    completed_this_run = 0
    last_checkpoint_completed = 0
    last_report_at = time.monotonic()
    total = len(ids)
    pending = [jid for jid in ids if jid not in done_ids]
    if max_details is not None:
        pending = pending[:max_details]
    print(f"[DETAIL] pending {len(pending)} / total {total}; failed {len(failed_ids)}", flush=True)

    for index, journal_id in enumerate(pending, start=1):
        url = detail_url(journal_id)
        if not is_allowed(rp, url):
            print(f"[WARN] robots.txt disallows detail URL: {url}", flush=True)
            failed_ids.add(journal_id)
            continue
        try:
            result = session.get(url, retries=detail_retries)
            record = parse_detail(result.text, journal_id, result.url)
            if not validate_record(record):
                raise RuntimeError("detail page parsed without required name/issn")
            records_by_id[journal_id] = record
            done_ids.add(journal_id)
            failed_ids.discard(journal_id)
            append_id(DONE_IDS_PATH, journal_id)
            completed_this_run += 1
        except Exception as exc:
            print(f"[WARN] detail failed for {journal_id}: {exc}", flush=True)
            failed_ids.add(journal_id)

        now = time.monotonic()
        if (
            completed_this_run
            and completed_this_run % 50 == 0
            and completed_this_run != last_checkpoint_completed
        ):
            checkpoint(records_by_id, done_ids, failed_ids)
            last_checkpoint_completed = completed_this_run
        if now - last_report_at >= 3600:
            print(
                f"[PROGRESS] completed {len(done_ids)} / {total}; failed {len(failed_ids)}; "
                f"run position {index}/{len(pending)}",
                flush=True,
            )
            last_report_at = now

    checkpoint(records_by_id, done_ids, failed_ids)


def main() -> int:
    parser = argparse.ArgumentParser(description="Scrape LetPub SCI journal data into journals.json")
    parser.add_argument("--index-mode", choices=["major", "all"], default="all")
    parser.add_argument("--rebuild-index", action="store_true")
    parser.add_argument("--max-pages-per-seed", type=int, default=500)
    parser.add_argument("--major-filter", default="", help="Regex filter for top-level LetPub subject category")
    parser.add_argument("--max-details", type=int, default=None, help="For smoke testing only")
    parser.add_argument("--delay-min", type=float, default=2.0)
    parser.add_argument("--delay-max", type=float, default=4.0)
    parser.add_argument("--soft-rate-limit-sleep", type=int, default=3600)
    parser.add_argument("--detail-retries", type=int, default=3)
    parser.add_argument("--skip-final-retry", action="store_true")
    parser.add_argument("--retry-failed-only", action="store_true")
    args = parser.parse_args()

    if args.delay_min < 2.0 or args.delay_max < args.delay_min:
        raise SystemExit("delay must respect the requested 2-4 second minimum unless code is edited intentionally")
    if args.detail_retries < 1:
        raise SystemExit("--detail-retries must be at least 1")

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    session = PoliteSession(args.delay_min, args.delay_max, soft_rate_limit_sleep=args.soft_rate_limit_sleep)
    rp = load_robots(session)
    records_by_id = load_existing_records()
    done_ids = read_id_set(DONE_IDS_PATH)
    done_ids.update(records_by_id.keys())
    failed_ids = read_id_set(FAILED_IDS_PATH)

    if args.retry_failed_only:
        ids = sorted(failed_ids, key=lambda x: int(x) if x.isdigit() else x)
    elif JOURNAL_IDS_PATH.exists() and not args.rebuild_index:
        ids = sorted(read_id_set(JOURNAL_IDS_PATH), key=lambda x: int(x) if x.isdigit() else x)
        print(f"[INDEX] loaded {len(ids)} journal IDs from {JOURNAL_IDS_PATH}", flush=True)
    else:
        main_result = session.get(JOURNALAPP_URL)
        categories = extract_categories(main_result.text)
        print(f"[INDEX] extracted {len(categories)} major categories", flush=True)
        ids = sorted(
            collect_journal_ids(
                session,
                rp,
                categories,
                args.index_mode,
                args.max_pages_per_seed,
                args.major_filter,
            ),
            key=lambda x: int(x) if x.isdigit() else x,
        )
        write_id_set(JOURNAL_IDS_PATH, ids)
        print(f"[INDEX] collected {len(ids)} unique journal IDs", flush=True)

    scrape_details(
        session,
        rp,
        ids,
        records_by_id,
        done_ids,
        failed_ids,
        max_details=args.max_details,
        detail_retries=args.detail_retries,
    )

    if failed_ids and not args.retry_failed_only and not args.skip_final_retry:
        retry_ids = sorted(failed_ids, key=lambda x: int(x) if x.isdigit() else x)
        print(f"[RETRY] retrying {len(retry_ids)} failed IDs once", flush=True)
        before_retry = set(failed_ids)
        scrape_details(session, rp, retry_ids, records_by_id, done_ids, failed_ids, detail_retries=args.detail_retries)
        still_failed = failed_ids.intersection(before_retry)
        write_id_set(FAILED_IDS_PATH, still_failed)
        failed_ids = still_failed

    checkpoint(records_by_id, done_ids, failed_ids)
    write_report(list(records_by_id.values()), failed_ids)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\n[STOP] interrupted by user", file=sys.stderr)
        raise SystemExit(130)
