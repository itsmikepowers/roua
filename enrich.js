const puppeteer = require('puppeteer');
const csv = require('fast-csv');
const fs = require('fs');
const readline = require('readline');
const os = require('os');
const path = require('path');

const headers2 = ["Judeţ", "Localitate/Sector", "Adresă", "Telefon", "Mobil", "Email", "Persoane din conducere:", "Adresă web", "Marketplace"];

const loginAndScrapeData = async (loginUrl, urlsWithOriginalData, writeToCsv, loginEmail, loginPassword, timeBetweenScrape) => {
    console.log(`Opening login page: ${loginUrl}...`);
    let browser = await puppeteer.launch({
        headless: true,
        defaultViewport: null,
        userDataDir: path.join(os.tmpdir(), 'puppeteer_' + Math.random().toString().substring(2)),
    });

    let page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537');
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

    // Setup listener for alert dialog and automatically accept it
    page.on('dialog', async dialog => {
        console.log('Alert dialog detected, accepting it...');
        await dialog.accept();
    });


    await new Promise(resolve => setTimeout(resolve, 3000));

    // Proceed with clicking the login button and entering credentials
    await page.click('#rememlg');
    await page.waitForSelector('input[name="nume"]', { visible: true });
    await page.type('input[name="nume"]', loginEmail);
    await page.type('input[name="pwd"]', loginPassword);
    await page.click('input[name="submitlog"]');

    // Wait for 3 seconds to ensure the login process is completed and any post-login alert is accepted
    await new Promise(resolve => setTimeout(resolve, 3000));

    for (const { url, originalData } of urlsWithOriginalData) {
        let retryCount = 0;
        const maxRetries = 3; // Set maximum number of retries here
    
        while (retryCount < maxRetries) {
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded' });
                await new Promise(resolve => setTimeout(resolve, timeBetweenScrape));
                const data = await page.evaluate(scrapePageData, headers2);
                const combinedData = { ...originalData, ...data };
                await writeToCsv(combinedData); // Write each scraped data to the CSV file
                console.log(`Finished scraping ${url}`);
                break; // Break the loop if the page was scraped successfully
            } catch (error) {
                console.log(`Failed to scrape. Restarting the browser...`);
                await new Promise(resolve => setTimeout(resolve, 20000));
                
                await browser.close();
                await new Promise(resolve => setTimeout(resolve, 10000));
                browser = await puppeteer.launch({
                    headless: false,
                    defaultViewport: null,
                    userDataDir: path.join(os.tmpdir(), 'puppeteer_' + Math.random().toString().substring(2))
                });
                page = await browser.newPage();
                await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
                page.on('dialog', async dialog => {
                    console.log('Alert dialog detected, accepting it...');
                    await dialog.accept();
                });
                await new Promise(resolve => setTimeout(resolve, 3000));
                await page.click('#rememlg');
                await page.waitForSelector('input[name="nume"]', { visible: true });
                await page.type('input[name="nume"]', loginEmail);
                await page.type('input[name="pwd"]', loginPassword);
                await page.click('input[name="submitlog"]');
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
    }

    await browser.close();
};


const waitForUserInput = () => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question('Type "go" to continue: ', (answer) => {
            rl.close();
            if (answer.toLowerCase() === 'go') resolve();
            else resolve(waitForUserInput()); // Loop until the user types "go"
        });
    });
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

const updateCsvWithCombinedData = async (loginUrl, inputCsvFilename, outputCsvFilename, loginEmail, loginPassword, timeBetweenScrape) => {
    const urlsWithOriginalData = [];

    // Create a writable stream for the output CSV and write the headers
    const csvStream = csv.format({ headers: true });
    const ws = fs.createWriteStream(outputCsvFilename);
    csvStream.pipe(ws);

    // Function to write data to the CSV
    const writeToCsv = (data) => {
        csvStream.write(data);
    };

    fs.createReadStream(inputCsvFilename)
        .pipe(csv.parse({ headers: true }))
        .on('data', row => {
            urlsWithOriginalData.push({ url: row.URL, originalData: { 'Page Number': row['Page Number'], 'Business Name': row['Business Name'], 'URL': row['URL'] } });
        })
        .on('end', async () => {
            console.log('Finished reading CSV');
            await loginAndScrapeData(loginUrl, urlsWithOriginalData, writeToCsv, loginEmail, loginPassword, timeBetweenScrape);
            csvStream.end(); // End the stream after all data has been written
        });
};



const loginEmail = 'catalingaitan620@gmail.com'
const loginPassword = 'Sandel123.'
const timeBetweenScrape = 500;
const loginUrl = 'https://membri.listafirme.ro/';
const inputCsvFilename = 'table_data.csv';
const outputCsvFilename = 'updated_with_combined_data.csv';

updateCsvWithCombinedData(loginUrl, inputCsvFilename, outputCsvFilename, loginEmail, loginPassword, timeBetweenScrape).catch(console.error);
