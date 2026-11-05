# Firestore layout for the Portal

Where each Google Sheet's data lives in Firestore (project `andrew-marth-portal`, database `(default)`, us-west1),
and the rules the copy script and the new API follow.

## Collections

| Sheet (tab) | Rows | Collection | Document ID |
|---|---|---|---|
| 1. ACCOUNT LIST (ACCOUNT_LIST) | 9 | `accounts` | the 10-digit phone number (ACCOUNT ID) |
| 3. INCOME (PAGE_LIST) | 2 | `income` | the 10-digit phone number (ACCOUNT ID) |
| 2. PAGES (PAGE_LIST) | 7 | `pages` | the PAGE ID (e.g. `4274`) |
| 5. LOAN PRODUCTS | 3 | `loanProducts` | automatic |
| 4. INTEREST RATE | 1 | `settings` | `interestRate` (one document) |
| 7. HOME INSPECTORS | 1 | `homeInspectors` | automatic |
| 8. SEWER INSPECTORS | 1 | `sewerInspectors` | automatic |
| 9. TERMITE INSPECTORS | 1 | `termiteInspectors` | automatic |
| 13. CUM TRANSACTIONS | 141 | `cumTransactions` | automatic |
| 15. CUM BALANCE (RECURRING) | 12 | `cumBalances` | automatic |
| 10. WHOLESALE PROPERTIES | 584 | `wholesaleDeals` | automatic |
| 11. LINKS | 14 | `links` | automatic |
| 19. DOCUMENTS (one tab per category) | 2 | `documents` | automatic (the CATEGORY field says which tab it was) |
| 16. TASKS | 3 | `tasks` | the TASK ID |
| Portal Signatures (SIGNATURES) | 3 | `signatures` | automatic (one per signer, as in the sheet) |

The wholesale email function's own sheets moved too:

| Sheet (tab) | Collection | Document ID |
|---|---|---|
| 12. WHOLESALE FILTER (ZIP) | `wholesaleZips` | the zip (its `ZIP CODE`): add a document to add a target zip, delete one to drop it |
| 17. WHOLESALE STATUS | `wholesaleStatus` | the property API's name (e.g. `REDFIN.COM DATA`), with `USAGE` (requests used this period, written by the function) and `CAP` (its limit) |
| 18. WHOLESALE HISTORY | `wholesaleHistory` | automatic: one per email a run handled (`DATE` with its time, `EMAIL`, `COMPANY`, `INDIVIDUAL`, `EMAIL LINK`, `API USED`, `SUCCESS`) |

The API also keeps a few collections of its own (not from sheets): `geocodes` (wholesale map positions),
`locks` (short-lived, so two requests don't hand out the same ID) and `filingClaims` (signed documents already filed).

## Rules for every document

- **Field names are the sheet's column headers, unchanged** (`PURCHASE PRICE`, `ALT ACCOUNT ID 1`, ...). The pages
  already read values by those names, so they keep working, and the Firebase console looks like the sheet.
- **Values are stored as real types:**
  - Numbers are numbers: `500000`, not `$500,000.00`.
  - Percentages are decimals: `0.025` for 2.5%, the same as the sheet's underlying value.
  - Yes/no columns are true/false.
  - Text is text.
- **Dates are text in `YYYY-MM-DD` form** (e.g. `2026-11-04`). They sort correctly and avoid time-zone shifts.
  Signatures' SENT DATE keeps its time too, as `YYYY-MM-DD HH:MM:SS` (Phoenix time).
- **Phone numbers / account IDs are 10-digit text** (`4805550123`) everywhere they appear, including
  `ALT ACCOUNT ID 1`, `LENDER ACCOUNT ID`, `SIGNER ACCOUNT ID 1` and the rest.
- **Blank cells are left out** of the document. A missing field reads as blank, the same as an empty cell.
- **Row order is kept in a `_order` number.** Copied rows get their sheet row number. New documents get the time
  they were created (in milliseconds), so they always sort after the copied rows. Lists that were "newest row
  last" in the sheet keep that order.

## Editing in the Firebase console

- To edit a value, open the document and change the field. Keep the type the same: number, boolean or string.
- To add a "column", add the field to the documents that need it. The API treats a missing field as blank, so
  documents without it don't need to be touched.
- To add a row, add a document. For collections with automatic IDs, give it an `_order` (any number larger than
  the others puts it last).

## Not copied

- **Script properties' geocode cache:** wholesale map lookups. It refills itself as the wholesale page loads.
- **FILING_ locks:** temporary markers while a signed envelope is filed. These become database transactions.
- **Documenso API token and webhook secret:** these move to Secret Manager in the Website APIs project, not to
  Firestore. At cutover, the Documenso webhook gets pointed at the new API with a new secret.

## Access

- Browsers can't read or write Firestore at all (`firestore/firestore.rules` denies everything). Everything goes
  through the Portal API, the same as today.
- The API runs as `portal-api@bamboo-research-511821-j2.iam.gserviceaccount.com`. It can read and write Firestore,
  and it reaches Google Drive as tiffany@andrewmarth.com, where the signed PDFs and wholesale photos stay.
