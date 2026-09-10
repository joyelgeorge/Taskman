# pdf-to-sheet — messy PDF → clean spreadsheet

The fulfilment engine for the PDF-extraction gig. Claude reads the PDF directly
(digital text **and** scanned pages), so the messy, multi-column, scanned
documents generic converters mangle are exactly what this handles — the edge you
sell against freelancers typing by hand.

## Run one order

```bash
export ANTHROPIC_API_KEY=sk-...           # your key; the LLM does the extraction
node cli.mjs order.pdf --out result.csv
# or steer the columns:
node cli.mjs statement.pdf --want "date, description, amount, balance" --out out.csv
```

Open the CSV in Excel/Sheets and deliver it. ~30 seconds vs an hour by hand.

## The operating model (Model B)

1. List a Fiverr gig: "AI-powered PDF/invoice → clean Excel, delivered fast."
2. Fiverr brings the buyers (6,000+ people search this category).
3. Per order: run the command, eyeball the CSV, deliver. Payment clears through Fiverr.
4. The app is your speed/price edge over sellers doing it manually.

## Cost & pricing

Each run is one API call. Charge per document (Fiverr gig tiers, e.g. $10 / 25 /
50 pages). The API cost per PDF is cents; the gig pays dollars.

## Later: self-serve

The same `pdfToRows()` becomes the backend of a self-serve web tool (upload →
pay-per-file) once the gig has reviews and you want passive volume. Nothing here
is throwaway.

## Note
Requires `ANTHROPIC_API_KEY`. Nothing is sent anywhere except the Anthropic API;
the PDF is not stored. Review each output before delivering — you are the quality gate.
