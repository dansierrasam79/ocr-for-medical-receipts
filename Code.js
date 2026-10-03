/**
 * Configuration Settings
 * Replace with the actual string IDs from your Google Drive folder URLs.
 */
const INPUT_FOLDER_ID = "add-your-string-id";
const ARCHIVE_FOLDER_ID = "add-your-string-id";

// Maximum runtime set to 4.5 minutes (270,000 ms) to safely stay below Apps Script's 6-minute ceiling
const MAX_EXECUTION_TIME_MS = 4.5 * 60 * 1000;

/**
 * Creates a custom menu in the Google Sheet UI for one-click execution.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("Tax OCR")
    .addItem("Process Incoming Bills", "processBillsForTax")
    .addToUi();
}

/**
 * Main orchestration function.
 * Iterates through images/PDFs in the input folder, calls Gemini,
 * populates the spreadsheet tabs, moves files to Archive, and auto-chains
 * to a new execution trigger if runtime nears the 6-minute limit.
 */
function processBillsForTax() {
  const startTime = new Date().getTime();

  const scriptProperties = PropertiesService.getScriptProperties();
  const apiKey = scriptProperties.getProperty("add_your_Gemini_API_key_here");

  if (!apiKey) {
    SpreadsheetApp.getUi().alert("Error: GEMINI_API_KEY is not configured in Script Properties.");
    return;
  }

  const inputFolder = DriveApp.getFolderById(INPUT_FOLDER_ID);
  const archiveFolder = DriveApp.getFolderById(ARCHIVE_FOLDER_ID);
  const files = inputFolder.getFiles();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheetsAndHeadersExist(ss);

  const summarySheet = ss.getSheetByName("GST_Summary");
  const itemsSheet = ss.getSheetByName("Item_Details");

  let processedCount = 0;
  let failureCount = 0;

  while (files.hasNext()) {
    // 1. Time Check: Prevent script timeout by self-scheduling next batch
    const elapsedTime = new Date().getTime() - startTime;
    if (elapsedTime > MAX_EXECUTION_TIME_MS) {
      Logger.log(`Approaching execution limit after ${processedCount} bills. Scheduling resume trigger in 1 minute...`);
      scheduleNextBatchRun();
      ss.toast(`Batch paused at ${processedCount} bills to avoid timeout. Resuming in 1 minute...`, "Auto-Resuming Queue", 10);
      return; // Clean exit before error
    }

    const file = files.next();
    const mimeType = file.getMimeType();

    // Accept common image types and PDFs
    if (mimeType.includes("image") || mimeType === "application/pdf") {
      Logger.log("Processing file: " + file.getName());
      try {
        const extractedData = callGeminiStructuredOCR(file, apiKey);

        // 2. Append Summary Row
        summarySheet.appendRow([
          extractedData.invoice_no || "N/A",
          extractedData.date || "N/A",
          extractedData.vendor_name || "N/A",
          extractedData.vendor_gstin || "N/A",
          extractedData.state || "N/A",
          extractedData.taxable_amount || 0,
          extractedData.cgst || 0,
          extractedData.sgst || 0,
          extractedData.igst || 0,
          extractedData.total_tax || 0,
          extractedData.grand_total || 0,
          file.getUrl()
        ]);

        // 3. Append Line Items
        if (extractedData.items && Array.isArray(extractedData.items)) {
          extractedData.items.forEach(item => {
            itemsSheet.appendRow([
              extractedData.invoice_no || "N/A",
              item.name || "N/A",
              item.hsn || "N/A",
              item.qty || 0,
              item.batch || "N/A",
              item.exp || "N/A",
              item.mrp || 0,
              item.gst_rate || 0,
              item.amount || 0
            ]);
          });
        }

        // 4. Move processed file to archive folder (prevents reprocessing on next run)
        file.moveTo(archiveFolder);
        processedCount++;
      } catch (err) {
        Logger.log("Failed to process " + file.getName() + ": " + err.message);
        failureCount++;
      }
    }
  }

  // All files in incoming folder finished; clear any scheduled triggers
  clearExistingQueueTriggers();

  const resultMessage = `Completed! Processed: ${processedCount} bill(s). Failed: ${failureCount}.`;
  Logger.log(resultMessage);
  ss.toast(resultMessage, "OCR Run Finished", 5);
}

/**
 * Schedules an automated trigger to resume execution after 1 minute.
 */
function scheduleNextBatchRun() {
  clearExistingQueueTriggers();
  ScriptApp.newTrigger("processBillsForTax")
    .timeBased()
    .after(60 * 1000)
    .create();
}

/**
 * Removes completed or duplicate triggers for this function.
 */
function clearExistingQueueTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "processBillsForTax") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/**
 * Sends the image blob to Gemini with automatic exponential backoff retries
 * and model fallback for 503 / high demand conditions.
 */
function callGeminiStructuredOCR(file, apiKey) {
  const base64Data = Utilities.base64Encode(file.getBlob().getBytes());
  const mimeType = file.getMimeType();

  // Primary model and fallback model
  const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

  const schema = {
    type: "OBJECT",
    properties: {
      invoice_no: { type: "STRING" },
      date: { type: "STRING", description: "Standard ISO format: YYYY-MM-DD" },
      vendor_name: { type: "STRING" },
      vendor_gstin: { type: "STRING" },
      state: { type: "STRING" },
      taxable_amount: { type: "NUMBER" },
      cgst: { type: "NUMBER" },
      sgst: { type: "NUMBER" },
      igst: { type: "NUMBER" },
      total_tax: { type: "NUMBER" },
      grand_total: { type: "NUMBER" },
      items: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            hsn: { type: "STRING" },
            qty: { type: "NUMBER" },
            batch: { type: "STRING" },
            exp: { type: "STRING" },
            mrp: { type: "NUMBER" },
            gst_rate: { type: "NUMBER" },
            amount: { type: "NUMBER" }
          },
          required: ["name", "amount"]
        }
      }
    },
    required: ["invoice_no", "vendor_gstin", "taxable_amount", "grand_total"]
  };

  const payload = {
    contents: [
      {
        parts: [
          { text: "Extract tax details, vendor details, and all line items from this tax invoice into the specified schema accurately." },
          { inline_data: { mime_type: mimeType, data: base64Data } }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema
    }
  };

  const options = {
    method: "POST",
    contentType: "application/json",
    headers: {
      "x-goog-api-key": apiKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  for (const model of models) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      Logger.log(`Calling ${model} (Attempt ${attempt}/${maxRetries})...`);
      const response = UrlFetchApp.fetch(endpoint, options);
      const statusCode = response.getResponseCode();
      const responseBody = response.getContentText();

      if (statusCode === 200) {
        const jsonResponse = JSON.parse(responseBody);
        const rawContent = jsonResponse.candidates[0].content.parts[0].text;
        return JSON.parse(rawContent);
      }

      // If server is overloaded (503) or rate-limited (429), wait and retry
      if (statusCode === 503 || statusCode === 429) {
        Logger.log(`${model} returned HTTP ${statusCode}. Waiting before retry...`);
        Utilities.sleep(attempt * 2500);
        continue;
      }

      // Other HTTP errors (400, 401, 403)
      throw new Error(`Gemini API Error (HTTP ${statusCode}): ${responseBody}`);
    }
    Logger.log(`${model} remained unavailable. Attempting fallback model...`);
  }

  throw new Error("All model endpoints are currently experiencing high demand. Please try again in a few moments.");
}

/**
 * Ensures the target tabs and column headers exist so the script never fails on a fresh sheet.
 */
function ensureSheetsAndHeadersExist(ss) {
  let summarySheet = ss.getSheetByName("GST_Summary");
  if (!summarySheet) {
    summarySheet = ss.insertSheet("GST_Summary");
    summarySheet.appendRow([
      "Bill No", "Date", "Vendor Name", "Vendor GSTIN", "State/Location",
      "Taxable Amount", "CGST", "SGST", "IGST", "Total Tax", "Grand Total", "Drive Link"
    ]);
    summarySheet.getRange("A1:L1").setFontWeight("bold");
  }

  let itemsSheet = ss.getSheetByName("Item_Details");
  if (!itemsSheet) {
    itemsSheet = ss.insertSheet("Item_Details");
    itemsSheet.appendRow([
      "Bill No", "Item Name", "HSN Code", "Quantity", "Batch",
      "Expiry", "MRP", "GST %", "Net Amount"
    ]);
    itemsSheet.getRange("A1:I1").setFontWeight("bold");
  }
}