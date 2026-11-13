# Firestore layout for the Portal

The portal's data lives in Firestore: project `andrew-marth-portal`, database `(default)`, in us-west1. The Portal
API (`api/`) and the wholesale email function (`wholesale-extractor/`) are the only things that read or write it.
You can edit it by hand in the Firebase console.

## Collections

| Collection | What's in it | Document ID |
|---|---|---|
| `accounts` | Each client and their roles (BUYER, SELLER, LENDER, ADMIN, CUM, ...), whether they're a veteran (VETERAN) and have used a VA loan before (VA LOAN USED), and what Down Payment Assistance programs ask about: PROFESSION GROUPS (JSON list of names from /dpa.js), LAST OWNED HOME (`Never`, or the year; blank when not said) and HOMEBUYER EDUCATION. Clients can edit these on their Settings page; their credit score stays in `income` | the 10-digit phone number (ACCOUNT ID) |
| `income` | Each client's jobs, debts and credit score | the 10-digit phone number (ACCOUNT ID) |
| `pages` | Buyer Breakdowns, Seller Nets and Flips (PAGE TYPE says which). LENDER FEE OVERRIDES: the page's own lender fee amounts (JSON { fee: amount }; the fee is a loan product fee column like APPRAISAL DEPOSIT, or "OTHER: " + an added fee's name), used instead of the loan product's | the PAGE ID (e.g. `4274`) |
| `loanProducts` | Lenders' loan products (ACCOUNT ID is the lender account that added it; LENDER NAME is its lender; RATE QUOTES is the lender's 27 quoted rates as JSON { QUOTES, TODAY } and BUYDOWN QUOTES its rates with 1%-4% in points as JSON { QUOTES }, see /rate-markups.js; MIN CREDIT SCORE is the lowest score it accepts, 300 for none; MAX DTI TIERS is its max DTI from each credit score as JSON [{ SCORE, DTI, HOUSING }]; MI QUOTES is its 27 annual mortgage insurance premiums as JSON { QUOTES } and NO MI GUIDELINES is TRUE for a Jumbo or Non-Conforming product without mortgage insurance, see /mortgage-insurance.js; a Down Payment Assistance product's DPA LOAN TYPE, its amount as SECOND LOAN AMOUNT TYPE with SECOND LOAN LTV MAX or SECOND LOAN FLAT AMOUNT, COMBINED LOANS CAN EXCEED PRICE, EXCESS REFUNDED TO BUYER, AFFECTS FIRST LOAN RATE, FIRST LOAN RATE MARKUP, DPA QUALIFICATIONS as JSON [{ TYPE, VALUE }], see /dpa.js; any product can be for certain professions / groups only: GROUP SPECIFIC, with ELIGIBLE GROUPS as a JSON list) | automatic |
| `lenders` | The admin Lenders card's lenders (NAME). A lender's loan products are those whose LENDER NAME is its name, and its linked lender accounts those whose LENDER BANK is its name | automatic |
| `settings` | `interestRate`: TODAY INTEREST RATE (Mortgage News Daily's 30 year fixed rate, pulled each weekday afternoon by the API's scheduled rate check; with RATE DATE, PREVIOUS INTEREST RATE, RATE SOURCE and RATE UPDATED AT). `mortgageInsurance`: the upfront mortgage insurance estimate's settings (MI REMOVAL LTV, HOME APPRECIATION, MI MIN YEARS, MI DISCOUNT RATE; see /mortgage-insurance.js) | `interestRate`, `mortgageInsurance` |
| `rateHistory` | Mortgage News Daily's rates for each day the rate check saved (30 YR FIXED, 15 YR FIXED, 30 YR JUMBO, 7/6 SOFR ARM, 30 YR FHA, 30 YR VA as decimals) | the date (`2026-11-13`) |
| `homeInspectors`, `sewerInspectors`, `termiteInspectors` | Each inspector's price list | automatic |
| `cumTransactions`, `cumBalances` | Cash flow transactions and bank balances (a Roadhouse Paycheck has TYPE `Roadhouse Paycheck` and its shifts in ROADHOUSE SHIFTS as JSON: [{ hours, sales, tipPercent }]) | automatic |
| `cumSettings` | Each CUM account's Roadhouse Paycheck Settings (TIP POOL PAYOUT %, TIP POOL RECEIVED %, HOURLY RATE, AZ / FITW / MED / SS TAX %; percents as decimals) and SAVINGS ALLOCATION (money set aside for savings; a Spending Budget transaction's own SAVINGS ALLOCATION is added to it on the budget's Monday, when the budget is checked off) | the 10-digit phone number (ACCOUNT ID) |
| `wholesaleDeals` | Wholesale deals from email (the flip map) | automatic |
| `links` | The admin Links card (TITLE, DESCRIPTION, SECTION, LINK) | automatic |
| `marketingPoints` | The admin Marketing Points card (TITLE, DESCRIPTION, LINK, LINK TEXT, and IMAGE DRIVE FILE ID / IMAGE NAME for a picture in the Marketing Points Drive folder) | automatic |
| `titleCompanies` | The admin Title Companies card: each company's filed fees (NAME, ESCROW RATE TABLE and OWNERS TITLE TABLE as lists of { UP TO, FEE }, add-ons, seller shares, DISCOUNTS, OTHER FEES) | automatic |
| `tasks` | Current Tasks (ASSIGNED is the account) | the TASK ID |
| `signatures` | One per signer of each document sent for signature | automatic |
| `documents` | One per signed PDF filed to Drive (CATEGORY says which log) | automatic |
| `wholesaleZips` | Target zips for wholesale deals: add a document to add a zip, delete one to drop it | the zip |
| `wholesaleStatus` | Each property API's `USAGE` (written by the function) and `CAP` (its limit) | the API's name (e.g. `REDFIN.COM DATA`) |
| `wholesaleHistory` | One per email the wholesale function handled | automatic |

The API also keeps a few collections of its own: `geocodes` (wholesale map positions), `locks` (short-lived, so two
requests don't hand out the same ID) and `filingClaims` (signed documents already filed).

## Rules for every document

- **Field names are upper-case column names** (`PURCHASE PRICE`, `ALT ACCOUNT ID 1`, ...). The pages read values by
  these names. `api/lib/columns.json` lists each collection's usual fields in order.
- **Values are stored as real types:**
  - Numbers are numbers: `500000`, not `$500,000.00`.
  - Percentages are decimals: `0.025` for 2.5%.
  - Yes/no fields are true/false.
  - Text is text.
- **Dates are text in `YYYY-MM-DD` form** (e.g. `2026-11-04`). They sort correctly and avoid time-zone shifts.
  Dates with a time (a signature's SENT DATE, a history entry's DATE) are `YYYY-MM-DD HH:MM:SS`, in Phoenix time.
- **Phone numbers / account IDs are 10-digit text** (`4805550123`) everywhere they appear, including
  `ALT ACCOUNT ID 1`, `LENDER ACCOUNT ID`, `SIGNER ACCOUNT ID 1` and the rest.
- **Blank values are left out** of the document. A missing field reads as blank.
- **List order is kept in an `_order` number.** New documents get the time they were created (in microseconds), so
  they sort after older ones.

## Editing in the Firebase console

- To edit a value, open the document and change the field. Keep the type the same: number, boolean or string.
- To add a field, add it to the documents that need it. The API treats a missing field as blank, so documents
  without it don't need to be touched.
- To add an entry to a collection with automatic IDs, add a document and give it an `_order` (any number larger
  than the others puts it last).

## Access

- Browsers can't read or write Firestore at all (`firestore.rules` denies everything). Everything goes through the
  Portal API.
- The API runs as `portal-api@bamboo-research-511821-j2.iam.gserviceaccount.com`. It can read and write Firestore,
  and it reaches Google Drive as tiffany@andrewmarth.com, where the signed PDFs and wholesale photos are.
- The wholesale function runs as `wholesale-deal-extractor@bamboo-research-511821-j2.iam.gserviceaccount.com`
  (Cloud Datastore User on this project).
- Secrets (Documenso API token, Maps geocoding key) are in Secret Manager in the Website APIs project.
