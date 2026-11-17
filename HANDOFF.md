# Handoff: Andrew Marth Client Portal

Last updated 2026-11-16.

## What this project is

- **Portal (front end):** static HTML/JS pages served by GitHub Pages at https://portal.andrewmarth.com from `main` of this repo. A push goes live in about a minute.
- **Portal API:** a Node 22 function (`api/`, entry point `portalApi`) on Cloud Run.
  - Service `portal-api`, project `bamboo-research-511821-j2` ("Website APIs"), region `us-west1`.
  - Current revision: **portal-api-00062-m9b**.
  - `firebase-config.js` holds `PORTAL_API_URL`.
- **Data:** Firestore, project `andrew-marth-portal`. Browsers can't reach it directly; everything goes through the API.
  - `firestore/LAYOUT.md` documents every collection and field.
  - `api/lib/columns.json` lists each collection's usual fields.
- **Wholesale extractor:** a separate Cloud Run service in `wholesale-extractor/`. It reads deal emails and writes them to Firestore.
- **Signed PDFs and wholesale photos:** stored in Google Drive, reached as tiffany@andrewmarth.com.

## What was done recently (newest first)

| Commit | What |
|---|---|
| `289da25` | **Buyer Breakdown: Buyers and Collaborators.**<br>• "Purchasers" is now **Buyers**: Buyer 1 is required, and "+ Add Buyer N" adds more, up to 4. They're saved in order: Buyer 1 in PRIMARY, Buyer 2 in ALT 1, and so on.<br>• **Buyer Type** is "As Individual(s)" or an LLC or trust that *every* buyer has in their own profile. It's stored in BUYER ENTITY TYPE and BUYER ENTITY NAME, and the API checks it too.<br>• **Collaborators** use the same one-per-line style with no limit. Those past the six account columns go in MORE COLLABORATORS (a JSON list) and can still open the page.<br>• Seller Net's pickers are unchanged. |
| `41fb9a9` | **Buyer Breakdown hides $0 lines.**<br>• HOA settings have their own section on both Buyer Breakdown and Seller Net, with an HOA yes/no that hides the rest when No.<br>• On Seller Net, switching HOA No → Yes restores the dues. |
| `245690c` | **Title discounts by Professions & Groups.**<br>• **Real Estate Owned** (a list of properties) replaces "Owned A Home Before".<br>• An **Active Military** group was added.<br>• Seller Net now applies the *sellers'* discounts on the seller side. |
| `2350d0a` | **Edit Clients:** Buyer Settings with LLCs and Trusts. The Hard Money Lender role was removed. |
| `a929d70` | **Settings:** LLCs and Trusts, profile sections, and Veteran in Professions & Groups. |

Earlier milestones:
- **Firestore migration:** the cutover was on 2026-11-05. Firestore is now the only source of truth.
- **The old Apps Script API and the Google Sheets are retired.** They're in tiffany@'s Drive Trash and can be restored until about **2026-12-05**. After that there is no rollback.

## Current state

- **Live and working:** everything up to commit `289da25`, with API revision 00062.
  - The API ping returns 200.
  - The live `pages.html` contains no Zillow code.
- **Not verified:** the new Buyers lines haven't been checked while signed in on the live site; they were tested locally only.
  - In the browser harness, saves were blocked: Buyer 1 greyed out on other lines, shared-LLC filtering, the 4-buyer cap, renumbering, and the save payload were all checked.
  - An API unit test passed 22 of 22.
- **Uncommitted work in the working tree: the Zillow feature, ON HOLD.** Andrew said: "I want to do more before we push this with net sheets."
  - Files: `api/lib/zillow.js` (mostly new) and Zillow parts of `api/portal.js`, `pages.html` and `settings.html` (about 200 lines in all).
  - What it does: Zillow views and saves for Seller Net pages.
    - A page setting holds the ZILLOW ZPID.
    - An "On Zillow" card is hidden by `SHOW_ZILLOW_CARD = false` in `pages.html`.
    - A Zillow lookup runs only when a new Zillow link is saved.
    - The scheduled morning check was removed. It used to run daily at 6 AM Phoenix for Listed homes only, to stay inside the 250-request/month free plan on RapidAPI's zillow191.
  - The RapidAPI key is in Secret Manager as `wde-rapidapi-key`. Never print it.
- **Local preview:** `.claude/launch.json` config `portal` serves this folder at http://127.0.0.1:5175.
  - Use 127.0.0.1, not localhost, so the saved sign-in carries over.
  - It runs the working-tree files, so it includes the Zillow changes, but it talks to the **live API**: anything saved there changes real data.

## How to ship (the process used so far)

1. **Only with Andrew's explicit OK, every time.** Deploy the API *before* pushing the front end.
2. **Stage only the non-Zillow hunks.** The Zillow work shares files with everything else:
   - Filter out hunks that match `/illow|zpid|ZPID/`, then `git apply --cached --recount`.
   - If a wanted change sits inside a Zillow hunk, patch the staged blob directly: `git show :file` → edit → `git hash-object -w --path=…` → `git update-index --cacheinfo …`.
3. **Commit to `main`.**
   - The message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
   - Never commit `.claude/`, `node_modules`, or local test harness files such as `zero-harness.html`.
4. **Deploy the API from a clean worktree of that commit,** never from the working tree, which holds Zillow code:
   ```powershell
   git worktree add --detach "$SP/rh-deploy" HEAD -q
   $env:PATH = "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin;$env:PATH"
   gcloud.cmd run deploy portal-api --source "$SP\rh-deploy\api" --function portalApi --base-image nodejs22 --region us-west1 --project bamboo-research-511821-j2 --quiet
   git worktree remove "$SP/rh-deploy" --force; git worktree prune
   ```
   Don't pass `--allow-unauthenticated` or `--no-allow-unauthenticated`: the second would remove the public access Andrew turned on in the console.
5. **Push:** `git push origin main`, then wait for GitHub Pages to serve the new code.

## House rules

- Tests must never change live data. Never submit real forms to live Zapier. Documenso must never send email.
- Andrew does these himself in the console:
  - secret writes
  - IAM grants
  - making services public
  - minting tokens for other users
- When gcloud sign-in expires ("invalid_rapt"), Andrew re-runs `gcloud auth login` and `gcloud auth application-default login` in his own terminal.
- He prefers sensible defaults over being asked questions.

## What's next

1. **Check the new Buyers / Buyer Type / Collaborators settings on a real Buyer Breakdown,** signed in on the live site. Saving there changes real data, so use a page Andrew is OK changing.
2. **Use Buyer 1 / 2 / 3 / 4 identification.** Andrew said the order "will be important later," for example for documents, signers, or per-buyer details. The order is saved, Buyer 1 = PRIMARY ACCOUNT ID, but nothing uses it yet beyond the page settings.
3. **Zillow feature:** waiting on Andrew. When he says go:
   - Finish whatever he wants added with net sheets.
   - Turn on `SHOW_ZILLOW_CARD`.
   - Decide whether to bring back the morning check, which would need a Cloud Scheduler job, `portal-zillow-check`.
   - Commit it and deploy it.
4. **Housekeeping:**
   - The Gemini prepaid credits for the wholesale extractor ran out (402 errors since 2026-11-03). Andrew needs to top them up in Google AI Studio. Stuck emails process once he does.
   - Decide before about **2026-12-05** whether anything in the trashed Sheets or Apps Script is still needed. After that they're gone for good.
