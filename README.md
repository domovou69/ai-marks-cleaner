# ai-marks-cleaner

Removes AI provenance marks (invisible Unicode characters, Office document metadata) from pasted text and
DOCX / XLSX / PPTX files. Everything runs in your browser; files never leave your device.

Site: https://domovou69.github.io/ai-marks-cleaner/ — works offline after the first load. The plan is in
[PLAN.md](PLAN.md).

## Development

```
git submodule update --init && npm install
npm run dev          # copies Pyodide and the engine into public/, starts Vite
npm run build        # type-check and build into dist/
npm run test:smoke   # engine in Pyodide under Node
npm run test:e2e     # builds, serves and tests the built site (needs: npx playwright install chromium)
```

Cleaning engine: [watermarks-remover](https://github.com/guillaumemeyer/watermarks-remover) by Guillaume Meyer (MIT).
