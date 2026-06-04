/**
 * Renders the HTML test report to PDF using Playwright's bundled Chromium.
 * Landscape + scale avoids wide-table cropping.
 */

const { chromium } = require("playwright");
const path = require("path");
const { pathToFileURL } = require("url");

/**
 * @param {string} htmlAbsPath - Absolute path to test-report-*.html
 * @returns {Promise<string>} Absolute path to the created PDF (same stem, .pdf)
 */
async function writePdfFromHtml(htmlAbsPath) {
  const resolved = path.resolve(htmlAbsPath);
  if (!resolved.toLowerCase().endsWith(".html")) {
    throw new Error("PDF export expects an .html file path");
  }
  const pdfPath = resolved.replace(/\.html$/i, ".pdf");

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1600, height: 1200 });
    const fileUrl = pathToFileURL(resolved).href;
    await page.goto(fileUrl, { waitUntil: "networkidle", timeout: 120000 });
    await page.emulateMedia({ media: "print" });

    // Ensure print layout is applied (landscape table in reporter.css @media print)
    await page.evaluate(() => {
      document.querySelectorAll("details").forEach((d) => d.setAttribute("open", ""));
      const wrap = document.querySelector(".table-wrap");
      if (wrap) wrap.style.overflow = "visible";
    });

    await page.pdf({
      path: pdfPath,
      format: "A4",
      landscape: true,
      printBackground: true,
      preferCSSPageSize: false,
      scale: 0.72,
      margin: { top: "10mm", right: "8mm", bottom: "16mm", left: "8mm" },
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate:
        '<div style="font-size:8px;color:#64748b;width:100%;text-align:center;padding:0 8mm;">HR Bot Test Report · Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    });
  } finally {
    await browser.close();
  }

  return pdfPath;
}

module.exports = { writePdfFromHtml };
