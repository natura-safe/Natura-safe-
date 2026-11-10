import asyncio, json, re, tempfile
from pathlib import Path
from playwright.async_api import async_playwright
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'hotspots.json'
META = ROOT / 'hotspots-meta.json'
URL = 'https://sipongi.gakkum.kehutanan.go.id/sebaran-titik-panas'

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(accept_downloads=True)
        page = await context.new_page()
        await page.goto(URL, wait_until='domcontentloaded', timeout=120000)
        await page.wait_for_timeout(5000)

        # Look for the official public XLSX download control without relying on
        # a private API. The page may change its HTML, so try several generic cues.
        candidates = page.locator('a,button,input[type="button"],input[type="submit"]')
        count = await candidates.count()
        target = None
        for i in range(count):
            el = candidates.nth(i)
            try:
                text = ((await el.inner_text()) or '').strip().lower()
            except Exception:
                text = ''
            try:
                href = (await el.get_attribute('href') or '').lower()
            except Exception:
                href = ''
            blob = f'{text} {href}'
            if ('xlsx' in blob or 'excel' in blob or 'unduh' in blob or 'download' in blob) and ('hotspot' in blob or 'titik' in blob or 'xls' in blob or 'excel' in blob):
                target = el
                break

        if target is None:
            # A final broad attempt: any visible element mentioning XLSX/Excel.
            target = page.get_by_text(re.compile(r'xlsx|excel', re.I)).first

        if target is None or await target.count() == 0:
            await browser.close()
            raise RuntimeError('Tombol/link XLSX resmi SiPongi tidak ditemukan. Halaman mungkin berubah.')

        async with page.expect_download(timeout=120000) as dl_info:
            await target.click()
        download = await dl_info.value
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / (download.suggested_filename or 'sipongi.xlsx')
            await download.save_as(str(path))
            xls = pd.ExcelFile(path)
            sheet = 'Detail' if 'Detail' in xls.sheet_names else xls.sheet_names[0]
            df = pd.read_excel(path, sheet_name=sheet)

        await browser.close()

    # Normalize the official SiPongi columns into the website's stable JSON schema.
    required = ['Provinsi','Kab Kota','Kecamatan','Desa','Tanggal','Waktu','Satelit','Confidence','Latitude','Longitude']
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise RuntimeError(f'Kolom SiPongi berubah/hilang: {missing}')

    records = []
    for _, r in df.iterrows():
        try:
            lat = float(r['Latitude']); lon = float(r['Longitude'])
        except Exception:
            continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        def clean(v):
            return '' if pd.isna(v) else str(v)
        records.append({
            'province': clean(r['Provinsi']),
            'regency': clean(r['Kab Kota']),
            'district': clean(r['Kecamatan']),
            'village': clean(r['Desa']),
            'date': clean(r['Tanggal']),
            'time': clean(r['Waktu']),
            'satellite': clean(r['Satelit']),
            'confidence': clean(r['Confidence']),
            'lat': lat,
            'lon': lon,
        })

    if not records:
        raise RuntimeError('Tidak ada titik hotspot valid dari file SiPongi.')

    from datetime import datetime, timezone
    OUT.write_text(json.dumps(records, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    META.write_text(json.dumps({'updated_at_utc': datetime.now(timezone.utc).isoformat(), 'record_count': len(records), 'source': URL, 'method': 'SiPongi public export XLSX'}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Updated {OUT} with {len(records)} hotspot records.')

if __name__ == '__main__':
    asyncio.run(main())
