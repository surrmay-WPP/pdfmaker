const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const { randomUUID } = require('crypto');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { JSDOM } = require('jsdom');
const { PDFDocument, rgb } = require('pdf-lib');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

const MOBILE_DEVICE = puppeteer.KnownDevices['iPhone SE'];
const DEFAULT_CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

function getEmailWidth(emailType, shamanMode, breakpointWidth) {
  if (shamanMode === 'shaman_mass') return 730;
  if (shamanMode === 'shaman_veeva') return 730;
  if (emailType !== 'mass' && breakpointWidth === 599) return 610;
  return emailType === 'mass' ? 710 : 710;
}

function detectBreakpointWidth(html) {
  if (/max-width:\s*599px/i.test(html)) return 599;
  if (/max-width:\s*699px/i.test(html)) return 699;
  return null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getDocumentDimensions(page) {
  return page.evaluate(() => {
    const body = document.body;
    const html = document.documentElement;
    return {
      width: Math.max(
        body.scrollWidth,
        body.offsetWidth,
        html.clientWidth,
        html.scrollWidth,
        html.offsetWidth,
      ),
      height: Math.max(
        body.scrollHeight,
        body.offsetHeight,
        html.clientHeight,
        html.scrollHeight,
        html.offsetHeight,
      ),
    };
  });
}

async function waitForPageAssets(page, timeoutMs = 20000) {
  const imagesLoaded = page.evaluate(async () => {
    const imageElements = Array.from(document.images || []);
    if (!imageElements.length) return;

    await Promise.all(
      imageElements.map((imageElement) => {
        if (imageElement.complete) return Promise.resolve();
        return new Promise((resolve) => {
          imageElement.addEventListener('load', resolve, { once: true });
          imageElement.addEventListener('error', resolve, { once: true });
        });
      }),
    );
  });

  await Promise.all([
    Promise.race([
      imagesLoaded,
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]),
    page.waitForNetworkIdle({ idleTime: 500, timeout: timeoutMs }).catch(() => {}),
  ]);
}

function extractGifSrcs(htmlString) {
  const $ = cheerio.load(htmlString);
  const srcList = [];

  $('img').each((index, element) => {
    const src = $(element).attr('src');
    if (!src) return;

    const srcLower = src.toLowerCase();
    if (src === 'https://a-cf65.gskstatic.com/etc/designs/default/0.gif') return;
    if (srcLower.endsWith('.gif') || srcLower.startsWith('data:image/gif;base64')) {
      srcList.push(src);
    }
  });

  return srcList;
}

function downloadFile(url, destinationPath, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error('Too many redirects while downloading GIF.'));
  }

  const client = url.startsWith('https://') ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.get(url, (response) => {
      const statusCode = response.statusCode || 0;

      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        const redirectUrl = new URL(response.headers.location, url).toString();
        response.destroy();
        downloadFile(redirectUrl, destinationPath, redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      if (statusCode >= 400) {
        reject(new Error(`Failed to download GIF: HTTP ${statusCode}`));
        return;
      }

      const file = fs.createWriteStream(destinationPath);
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
      file.on('error', reject);
    });

    request.on('error', reject);
  });
}

async function extractGifFrameAsBase64(input, timestamp = 1.5) {
  if (!ffmpegPath) {
    throw new Error('ffmpeg binary not found.');
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-maker-gif-'));
  const gifPath = path.join(tempRoot, `${randomUUID()}.gif`);
  const framePath = path.join(tempRoot, `${randomUUID()}.png`);

  try {
    if (input.startsWith('data:')) {
      const base64Data = input.split(',')[1] || '';
      await fs.promises.writeFile(gifPath, Buffer.from(base64Data, 'base64'));
    } else if (input.startsWith('http://') || input.startsWith('https://')) {
      await downloadFile(input, gifPath);
    } else {
      throw new Error('Invalid GIF input source.');
    }

    await new Promise((resolve, reject) => {
      ffmpeg(gifPath)
        .screenshots({
          timestamps: [String(timestamp)],
          filename: path.basename(framePath),
          folder: tempRoot,
          size: '500x?',
        })
        .on('end', resolve)
        .on('error', reject);
    });

    const imageData = await fs.promises.readFile(framePath);
    return `data:image/png;base64,${imageData.toString('base64')}`;
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
}

function buildAltTextHtml(htmlContent) {
  const dom = new JSDOM(htmlContent);
  const document = dom.window.document;
  const imgElements = document.querySelectorAll('img');

  imgElements.forEach((imgElement) => {
    const parentElement = imgElement.parentNode;

    if (parentElement && parentElement.nodeType === 1) {
      const existingStyles = parentElement.getAttribute('style') || '';
      const updatedStyles = `${existingStyles};font-size: 14px;`;
      parentElement.setAttribute('style', updatedStyles);
    }

    imgElement.style.fontStyle = 'italic';
    imgElement.style.overflow = 'visible';
    imgElement.style.lineHeight = '14px';

    if (imgElement.getAttribute('alt') === 'Trans icon') {
      imgElement.alt = '';
    }

    const widthAttr = Number(imgElement.getAttribute('width') || 0);
    if (widthAttr && widthAttr <= 45) {
      if (!imgElement.getAttribute('alt')) {
        imgElement.alt = '.';
        imgElement.style.fontSize = '0px';
      } else {
        const adjustedWidth = (imgElement.getAttribute('alt').length || 0) * 12;
        imgElement.width = adjustedWidth > 80 ? 80 : adjustedWidth;
      }
    }
  });

  const updatedHtml = dom.serialize();
  return updatedHtml.replace(/src/g, 'srt');
}

function buildSummaryHtml(htmlContent, subjectLines, preheaderLines) {
  const $ = cheerio.load(htmlContent);
  const finalSubjects = [...subjectLines];
  const finalPreheaders = [...preheaderLines];

  const title = $('title').text().trim();
  if (title) {
    finalSubjects.unshift(title);
  }

  let preheader = $('body > div:first').text().trim();
  if ($('body > div:first').attr('id') === 'canvas' || preheader === '') {
    preheader = null;
  }
  if (preheader) {
    finalPreheaders.unshift(preheader);
  }

  const subjectMarkup = finalSubjects
    .map((line, index) => {
      const label = finalSubjects.length === 1 ? 'Subject Line:' : `Subject Line ${index + 1}:`;
      return `
        <div style="text-align:left;padding-top:6px;">
          <strong style="font-size:16px;line-height:24px;font-family:Arial,sans-serif;">${label} </strong>
          <span style="font-size:16px;line-height:24px;font-family:Arial,sans-serif;">${escapeHtml(line)}</span>
        </div>
      `;
    })
    .join('');

  const preheaderMarkup = finalPreheaders
    .map((line, index) => {
      const label = finalPreheaders.length === 1 ? 'PreHeader:' : `PreHeader ${index + 1}:`;
      return `
        <div style="text-align:left;padding-top:6px;">
          <strong style="font-size:16px;line-height:24px;font-family:Arial,sans-serif;">${label} </strong>
          <span style="font-size:16px;line-height:24px;font-family:Arial,sans-serif;">${escapeHtml(line)}</span>
        </div>
      `;
    })
    .join('');

  return `
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body style="margin:0;padding:20px 10px 20px 10px;">
        ${subjectMarkup}
        ${preheaderMarkup}
      </body>
    </html>
  `;
}

function resolveExecutablePath() {
  const configured = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (configured && fs.existsSync(configured)) return configured;
  if (fs.existsSync(DEFAULT_CHROME_PATH)) return DEFAULT_CHROME_PATH;
  return null;
}

async function launchBrowser() {
  const launchOptions = {
    headless: 'new',
    timeout: 80000,
  };

  const executablePath = resolveExecutablePath();
  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }

  return puppeteer.launch(launchOptions);
}

async function makePDF(requestBody) {
  if (!requestBody || typeof requestBody.data !== 'string') {
    throw new Error('Invalid payload: `data` (email HTML) is required.');
  }

  const inputHtml = requestBody.data.replace(/%%\[[\s\S]*?\]%%/g, '');
  if (!inputHtml.trim()) {
    throw new Error('Email HTML cannot be empty.');
  }

  const emailType = inputHtml.includes('%%=ContentBlockByKey') ? 'mass' : 'veeva';
  const subjectLines = String(requestBody.subject2 || '')
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
  const preheaderLines = String(requestBody.preheader2 || '')
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
  const includeMobileView = Boolean(requestBody.mobileView);

  let shamanMode = requestBody.shaman ? 'shaman' : '';
  if (shamanMode && inputHtml.includes('@media (max-width: 720px)')) {
    shamanMode = 'shaman_mass';
  } else if (shamanMode && inputHtml.includes('@media (max-width: 620px)')) {
    shamanMode = 'shaman_veeva';
  }

  const breakpointWidth = detectBreakpointWidth(inputHtml);
  const widthValue = getEmailWidth(emailType, shamanMode, breakpointWidth);
  let htmlForRendering = inputHtml;

  const gifSources = extractGifSrcs(htmlForRendering);
  for (const gifUrl of gifSources) {
    if (!htmlForRendering.includes(gifUrl)) continue; 

    try {
      const gifFrame = await extractGifFrameAsBase64(gifUrl);
      const gifRegex = new RegExp(escapeRegExp(gifUrl), 'g');
      htmlForRendering = htmlForRendering.replace(gifRegex, gifFrame);
    } catch (error) {
      console.warn(`GIF replacement skipped for ${gifUrl}:`, error.message);
    }
  }

  const browser = await launchBrowser();

  try {
    const firstPage = await browser.newPage();
    await firstPage.setCacheEnabled(false);
    await firstPage.setViewport({
      width: widthValue,
      height: 600,
      isMobile: true,
      deviceScaleFactor: 1,
    });
    await firstPage.setContent(htmlForRendering, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await firstPage.emulateMediaType('screen');
    await waitForPageAssets(firstPage);

    const firstPageDimensions = await getDocumentDimensions(firstPage);
    const pdf1Buffer = await firstPage.pdf({
      width: `${firstPageDimensions.width + 20}px`,
      height: `${firstPageDimensions.height + 20}px`,
      printBackground: true,
      scale: 1,
      margin: { top: '10px', right: '10px', bottom: '10px', left: '10px' },
    });
    await firstPage.close();

    let pdfMobileBuffer = null;
    if (includeMobileView) {
      const mobilePage = await browser.newPage();
      await mobilePage.setCacheEnabled(false);
      await mobilePage.emulate(MOBILE_DEVICE);
      await mobilePage.setViewport({
        width: 420,
        height: 500,
        isMobile: true,
        deviceScaleFactor: 2,
      });
      await mobilePage.setContent(htmlForRendering, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await mobilePage.emulateMediaType('screen');
      await waitForPageAssets(mobilePage);

      const screenshot = await mobilePage.screenshot({
        type: 'png',
        fullPage: true,
        omitBackground: false,
      });
      await mobilePage.close();

      const MOBILE_SIDE_MARGIN = 10;
      const mobileDoc = await PDFDocument.create();
      const mobileImage = await mobileDoc.embedPng(screenshot);
      const mobilePageWidth = mobileImage.width + MOBILE_SIDE_MARGIN * 2;
      const mobileImagePage = mobileDoc.addPage([mobilePageWidth, mobileImage.height]);
      mobileImagePage.drawRectangle({
        x: 0,
        y: 0,
        width: mobilePageWidth,
        height: mobileImage.height,
        color: rgb(1, 1, 1),
      });
      mobileImagePage.drawImage(mobileImage, {
        x: MOBILE_SIDE_MARGIN,
        y: 0,
        width: mobileImage.width,
        height: mobileImage.height,
      });
      pdfMobileBuffer = await mobileDoc.save();
    }

    const altHtml = buildAltTextHtml(htmlForRendering);
    const secondPage = await browser.newPage();
    await secondPage.setCacheEnabled(false);
    await secondPage.setViewport({
      width: widthValue,
      height: 600,
      isMobile: true,
      deviceScaleFactor: 1,
    });
    await secondPage.setContent(altHtml, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await secondPage.emulateMediaType('screen');
    await waitForPageAssets(secondPage);

    const secondPageDimensions = await getDocumentDimensions(secondPage);
    const pdf2Buffer = await secondPage.pdf({
      width: `${firstPageDimensions.width + 20}px`,
      height: `${secondPageDimensions.height + 20}px`,
      printBackground: true,
      scale: 1,
      margin: { top: '10px', right: '10px', bottom: '10px', left: '10px' },
    });
    await secondPage.close();

    const summaryHtml = buildSummaryHtml(htmlForRendering, subjectLines, preheaderLines);
    const summaryPage = await browser.newPage();
    await summaryPage.setCacheEnabled(false);
    await summaryPage.setViewport({
      width: widthValue,
      height: 200,
      deviceScaleFactor: 1,
    });
    await summaryPage.setContent(summaryHtml, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await summaryPage.emulateMediaType('screen');
    await waitForPageAssets(summaryPage);

    const summaryDimensions = await getDocumentDimensions(summaryPage);
    // Use the tight bounding rect of the body's last child to avoid whitespace
    // from the viewport height inflating scrollHeight/offsetHeight.
    const summaryContentHeight = await summaryPage.evaluate(() => {
      const body = document.body;
      if (!body || !body.lastElementChild) return body ? body.scrollHeight : 0;
      const rect = body.lastElementChild.getBoundingClientRect();
      return Math.ceil(rect.bottom + (parseFloat(getComputedStyle(body).paddingBottom) || 0));
    });
    const summaryHeight = Math.max(summaryContentHeight + 20, 60);
    const pdf3Buffer = await summaryPage.pdf({
      width: `${Math.max(summaryDimensions.width + 20, widthValue)}px`,
      height: `${summaryHeight}px`,
      printBackground: true,
      scale: 1,
      margin: { top: '0px', right: '10px', bottom: '0px', left: '10px' },
    });
    await summaryPage.close();

    const mergedPdf = await PDFDocument.create();
    const firstPdf = await PDFDocument.load(pdf1Buffer);
    const secondPdf = await PDFDocument.load(pdf2Buffer);
    const thirdPdf = await PDFDocument.load(pdf3Buffer);

    const [thirdPage] = await mergedPdf.copyPages(thirdPdf, [0]);
    const [firstPdfPage] = await mergedPdf.copyPages(firstPdf, [0]);
    const [secondPdfPage] = await mergedPdf.copyPages(secondPdf, [0]);

    mergedPdf.addPage(thirdPage);
    mergedPdf.addPage(firstPdfPage);

    if (pdfMobileBuffer) {
      const mobilePdf = await PDFDocument.load(pdfMobileBuffer);
      const [mobilePdfPage] = await mergedPdf.copyPages(mobilePdf, [0]);
      mergedPdf.addPage(mobilePdfPage);
    }

    mergedPdf.addPage(secondPdfPage);

    mergedPdf.setTitle('Empower Engine');
    mergedPdf.setAuthor('Arnab Adhikary');
    mergedPdf.setSubject('Empower Engine');
    mergedPdf.setKeywords(['pdf', 'metadata']);
    mergedPdf.setProducer('Empower Engine');
    mergedPdf.setCreator('PDF Maker Web');
    mergedPdf.setCreationDate(new Date());
    mergedPdf.setModificationDate(new Date());

    return Buffer.from(await mergedPdf.save());
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

module.exports = { makePDF };
