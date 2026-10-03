# Tax Invoice OCR & GST Automation Pipeline
An automated document processing pipeline running on Google Apps Script and powered by Google Gemini multimodal models (`gemini-2.5-flash` and `gemini-2.5-flash-lite`). 

The script monitors an incoming Google Drive folder for invoice images and PDFs, extracts structured invoice summaries and line items conforming to Indian GST requirements, populates dedicated Google Sheets tabs, and moves processed files to an archive folder.
---

## Key Features
- **Automated Two-Tab Ingestion:**
  - `GST_Summary`: High-level financial audit trail (Bill Number, Date, Vendor GSTIN, Taxable Amount, CGST, SGST, IGST, Total Tax, Grand Total, and Drive Link).
  - `Item_Details`: Granular line items (Item Name, HSN Code, Quantity, Batch, Expiry, MRP, GST %, and Net Amount).
- **Execution Limit Protection (Self-Chaining Triggers):** Tracks elapsed runtime against a safe threshold (4.5 minutes) to respect Google Apps Script's 6-minute hard ceiling. Before timing out, the script pauses cleanly, schedules an automated one-time trigger to resume in 1 minute, and picks up remaining files.
- **Atomic File Movement:** Moves processed files from the input folder to the archive folder immediately after writing rows, preventing duplicate processing during automated batch restarts.
- **Model Fallback & Transient Error Retries:** Implements exponential backoff for `HTTP 429` (rate limits) and `HTTP 503` (high demand), automatically falling back from `gemini-2.5-flash` to `gemini-2.5-flash-lite` if the primary model is saturated.
- **Custom UI Menu:** Adds a one-click **"Tax OCR > Process Incoming Bills"** menu directly inside the Google Sheets interface.
---

## Repository Structure
```text
├── Code.js        # Core Google Apps Script orchestration & Gemini API integration
├── README.md      # Setup, deployment, and configuration guide
└── .gitignore     # Git configuration for local tracking

## Prerequisites
1. **Google Cloud / Google AI Studio API Key** with access to Gemini multimodal models.
2. **Google Spreadsheet** configured to collect extracted invoice data.
3. **Two Google Drive Folders**:
   - **Incoming / Input Folder:** Storage location where raw invoice images (`.jpg`, `.png`, `.webp`) or `.pdf` files are uploaded.
   - **Archive Folder:** Destination directory where processed invoices are moved automatically upon completion.
---

## Setup and Installation
### 1. Configure Google Drive Folders
1. Create two dedicated folders in Google Drive (e.g., `Invoices_Incoming` and `Invoices_Archive`).
2. Extract the Folder ID from each folder's URL:
   ```text
   [https://drive.google.com/drive/folders/](https://drive.google.com/drive/folders/)<FOLDER_ID_IS_HERE>

### 2. Attach Script to Your Google Sheet
1. Open your target Google Sheet.
2. Navigate to **Extensions** > **Apps Script**.
3. Clear any boilerplate code in the script editor and paste the contents of `Code.js`.
4. Update the folder ID constants at the top of the file:
   ```javascript
   const INPUT_FOLDER_ID = "YOUR_ACTUAL_INPUT_FOLDER_ID";
   const ARCHIVE_FOLDER_ID = "YOUR_ACTUAL_ARCHIVE_FOLDER_ID";

### 3. Store API Key Securely in Script Properties
To avoid exposing sensitive credentials, do not hardcode your API key inside the script file.
- In the Apps Script editor, open **Project Settings** (gear icon on the left sidebar).
- Scroll to **Script Properties** and click **Add script property**.

Enter the following key-value pair:
- **Property:** `GEMINI_API_KEY`
- **Value:** `YOUR_GEMINI_API_KEY`

Click **Save script properties**.
---

## Usage
- Drop invoice images or PDFs into your configured **Input Folder**.
- Open your Google Sheet and reload the page.
- Click the custom menu: **Tax OCR > Process Incoming Bills**.
- Grant the requested Google Workspace permissions (Drive file management, Spreadsheet edits, and external URL fetch requests) during the initial authorization prompt.

The pipeline executes sequentially:
- Extracted invoice headers and line items populate the `GST_Summary` and `Item_Details` sheets.
- Processed files automatically transfer to the **Archive Folder**.
- If processing time approaches 4.5 minutes, a sheet toast notification will indicate that execution is paused and scheduled to resume automatically in 1 minute.

## Technical Specifications
| Parameter | Specification |
| :--- | :--- |
| **Runtime Environment** | Google Apps Script (V8 Engine) |
| **Primary AI Model** | `gemini-2.5-flash` |
| **Fallback AI Model** | `gemini-2.5-flash-lite` |
| **Output Format** | Structured JSON (`responseMimeType: "application/json"`) |
| **Execution Guard** | 270,000 ms (4.5 min) threshold with time-based trigger chaining |
| **Supported File Formats** | Images (`image/*`) and PDF (`application/pdf`) |
---

## License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.