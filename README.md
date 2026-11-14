# Price Check

A desktop app that loads a shopping list from Excel, searches Takealot, Amazon.co.za, Clicks, Dis-Chem and Makro,
flags specials and bulk options, and exports the comparison to Excel. Works on Windows and Mac.

## Install and run

**Windows (10/11, 64-bit)**
1. Unzip `PriceCheck-Windows-x64.zip` anywhere (for example `C:\PriceCheck`).
2. Double-click `Price Check.exe`.
3. First launch: Windows SmartScreen may say "Windows protected your PC". Click **More info**, then **Run anyway**.
   (The app is not code-signed. That needs a paid certificate.)

**Mac (macOS 12 or newer)**
1. Unzip the right file: `PriceCheck-Mac-AppleSilicon.zip` for M1/M2/M3/M4 Macs, `PriceCheck-Mac-Intel.zip` for older Intel Macs
   (Apple menu > About This Mac shows which you have).
2. Drag `Price Check.app` into your Applications folder.
3. One-off step, because the app is not signed by Apple: open Terminal, type `bash ` (with the space), drag
   `PriceCheck-Mac-first-run.command` into the window and press Return. Then open the app normally.
   (Alternative: right-click the app, choose Open, then Open again.)

## Using it
1. **Shopping list**: click *Choose Excel list...* (or *Save a sample list* to see the format).
2. **Stores**: tick the stores to search.
3. **Search prices**: takes a few minutes for ten items. Store sites are loaded in hidden windows.
4. If a store asks for a "human check" (Makro does), a window opens: complete it, click *Continue*, or skip that store.
5. **Export to Excel** gives you Best Prices, Shopping List, Price Comparison and Notes sheets.

### Excel list format
Header row, one item per row. Columns (any order, names not case-sensitive):

| column | meaning |
|---|---|
| name | what you want (required) |
| brand | brand, blank for any |
| variant | free text, e.g. "Invisible Fresh Deodorant Spray" |
| size | minimum size, e.g. `750ml min`, `1 or 2kg`, `450g min` |
| quantity | `6` items, or a total like `12kg` (the app prices that total) |
| alternatives | Yes also suggests other brands |
| notes | free text |
| search terms *(optional)* | words typed into each store search, short works best |
| must include *(optional)* | words a title must contain to count as an exact match, e.g. `cool,mint` |

## How matching works (and its limits)
- A listing is **Exact** when it contains the brand and your *must include* words (or most of the name when you give none)
  and meets your size rule. Otherwise it is an **Alternative** (different variant, below your size, size not shown).
- Multipacks are detected from titles ("6 x 500ml", "Pack of 5", "1kg x 2"); per-unit price = price / units.
- A price per unit far above the other listings is flagged as a possible multipack or mark-up.
- Matching is automatic: **review before buying**. Add *must include* words to tighten it.
- Store websites change; if a store stops returning results the code in `src/stores.js` needs a small update.
- Makro is read from the rendered page and is the least reliable. Amazon rate-limits quickly, so the app paces itself.
- Prices are a snapshot from when you pressed Search.

## Build it yourself
Needs Node.js 20+ (https://nodejs.org).
```
npm install
npm test            # logic tests
npm start           # run the app
npm run dist:win    # on Windows: installer + zip in dist/
npm run dist:mac    # on a Mac: .dmg + zip in dist/
```
No Mac or Windows PC handy? Push this folder to a GitHub repository and run the **Build installers** workflow
(Actions tab). It builds Windows and Mac installers in the cloud and attaches them as downloads.
