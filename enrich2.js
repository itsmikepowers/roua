const puppeteer = require('puppeteer');
const csv = require('fast-csv');
const fs = require('fs');
const readline = require('readline');

const headers2 = ["Judeţ", "Localitate/Sector", "Adresă", "Telefon", "Mobil", "Email", "Persoane din conducere:", "Adresă web", "Marketplace"];

const loadCookies = async (page) => {
    const cookiesFilePath = 'cookies.json';
    const cookiesString = await fs.promises.readFile(cookiesFilePath);
    const cookies = JSON.parse(cookiesString);
    await page.setCookie(...cookies);
};

const loginAndScrapeData = async (loginUrl, urlsWithOriginalData) => {
    const browser = await puppeteer.launch({
        headless: true, // Run browser in headless mode
        userDataDir: './user_data',
        defaultViewport: null
    });

    const pages = await Promise.all(new Array(5).fill().map(() => browser.newPage()));
    await Promise.all(pages.map(page => loadCookies(page))); // Load cookies for each page

    const scrapedData = [];
    for (let i = 0; i < urlsWithOriginalData.length; i += 5) {
        const chunk = urlsWithOriginalData.slice(i, i + 5);
        const data = await Promise.all(chunk.map(async ({ url, originalData }, index) => {
            const page = pages[index];
            await page.goto(url, { waitUntil: 'networkidle2' });
            const data = await page.evaluate(scrapePageData, headers2);
            const combinedData = { ...originalData, ...data };
            console.log(`Finished scraping ${url}`);
            return combinedData;
        }));

        scrapedData.push(...data);
    }

    await browser.close();
    return scrapedData;
};


const scrapePageData = (headers2) => {
    const extractTableData = (table) => {
        const data = {};
        table.querySelectorAll('tr').forEach(row => {
            const cols = row.querySelectorAll('td');
            if (cols.length > 1) {
                const key = cols[0].textContent.trim();
                const value = cols[1].textContent.trim();
                data[key] = value;
            }
        });
        return data;
    };

    const firstTableData = extractTableData(document.querySelector('table'));

    let localizationData = {};
    for (let i = 5; i >= 2; i--) { // Start from the 6th table and go backwards
        const table = document.querySelectorAll('table')[i];
        if (table) {
            const tempData = extractTableData(table);
            if (Object.keys(tempData).length > 0) {
                localizationData = tempData;
                break;
            }
        }
    }

    // Convert localization data to match headers2 structure
    const structuredLocalizationData = headers2.reduce((acc, header) => {
        Object.keys(localizationData).forEach(key => {
            const keyWords = key.split(' ');
            if (keyWords[0].startsWith(header.substring(0, 2))) { // Check first two letters
                if (header === 'Adresă' && keyWords.length === 1) {
                    acc[header] = localizationData[key];
                } else if (header === 'Adresă web' && keyWords.length > 1) {
                    acc[header] = localizationData[key];
                } else if (header !== 'Adresă' && header !== 'Adresă web') {
                    acc[header] = localizationData[key];
                }
            }
        });
        if (!acc[header]) acc[header] = ""; // Ensure all headers have a value
        return acc;
    }, {});

    return { ...firstTableData, ...structuredLocalizationData };
};

const updateCsvWithCombinedData = async (loginUrl, inputCsvFilename, outputCsvFilename) => {
    const urlsWithOriginalData = [];

    fs.createReadStream(inputCsvFilename)
        .pipe(csv.parse({ headers: true }))
        .on('data', row => {
            // Include the original row data along with the URL
            urlsWithOriginalData.push({ url: row.URL, originalData: { 'Page Number': row['Page Number'], 'Business Name': row['Business Name'], 'URL': row['URL'] } });
        })
        .on('end', async () => {
            console.log('Finished reading CSV');
            const scrapedData = await loginAndScrapeData(loginUrl, urlsWithOriginalData);

            const ws = fs.createWriteStream(outputCsvFilename);
            csv.write(scrapedData, { headers: true }).pipe(ws);
        });
};

const loginUrl = 'https://membri.listafirme.ro/';
const inputCsvFilename = 'table_data.csv';
const outputCsvFilename = 'updated_with_combined_data.csv';

updateCsvWithCombinedData(loginUrl, inputCsvFilename, outputCsvFilename).catch(console.error);
