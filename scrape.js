const puppeteer = require('puppeteer');
const fs = require('fs');
const readline = require('readline');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const csvWriter = createCsvWriter({
    path: 'table_data.csv',
    header: [
        {id: 'pageNumber', title: 'Page Number'}, 
        {id: 'businessName', title: 'Business Name'},
        {id: 'url', title: 'URL'}
    ]
});

let browser; // Global reference to the browser instance

// Function to initialize Puppeteer and navigate to the start page
async function navigateToPage(pageUrl) {
    if (!browser) {
        browser = await puppeteer.launch({
            headless: false, // Open the browser UI
            userDataDir: './user_data', // Specify the path to store user data
            defaultViewport: null
        });
    }
    const page = await browser.newPage();
    await page.goto(pageUrl, {waitUntil: 'networkidle2'});
    return page; // Returns the new page instance
}

// Function to wait for user input for the number of pages to scrape
async function waitForUserInput(page) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question("Enter the number of pages you want to scrape: ", answer => {
            rl.close();
            resolve(Number(answer));
        });
    });
}

// Function to scrape and write data from the current page, including the page number
async function scrapeAndWriteCurrentPage(page, currentPageNumber) {
    const data = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('table tr'));
        return rows.slice(1).map(row => {
            const columns = row.querySelectorAll('td');
            const businessName = columns[1]?.querySelector('a')?.innerText.trim();
            const href = columns[1]?.querySelector('a')?.getAttribute('href');
            const fullUrl = `https://membri.listafirme.ro${href}`;
            return { businessName, url: fullUrl };
        }).filter(row => row.businessName && row.url);
    });

    // Add the current page number to each data entry
    const dataWithPageNumber = data.map(entry => ({
        ...entry,
        pageNumber: currentPageNumber
    }));

    if (dataWithPageNumber.length > 0) {
        await csvWriter.writeRecords(dataWithPageNumber);
        console.log(`Data written for ${dataWithPageNumber.length} businesses on page ${currentPageNumber}.`);
    }
}

// Function to click the next page button
async function clickNextPage(page) {
    const nextPageButton = await page.$(".fa-arrow-right"); // Adjust selector as needed
    if (nextPageButton) {
        await nextPageButton.click();
        await page.waitForNavigation({waitUntil: 'networkidle2'});
        return true;
    }
    return false;
}

// Main function to orchestrate the scraping
async function main(startPageUrl) {
    const page = await navigateToPage(startPageUrl);
    const pagesToScrape = await waitForUserInput(page);

    for (let currentPage = 1; currentPage <= pagesToScrape; currentPage++) {
        await scrapeAndWriteCurrentPage(page, currentPage);
        const hasNextPage = await clickNextPage(page);
        if (!hasNextPage) break; // Exit the loop if there's no next page
    }

    // Export cookies to a file
    const cookies = await page.cookies();
    fs.writeFileSync('cookies.json', JSON.stringify(cookies, null, 2));
    console.log("Cookies have been exported to cookies.json.");

    await browser.close();
    console.log("Scraping complete. CSV file has been created.");
}

// Usage example
const startPageUrl = "https://membri.listafirme.ro/"; // Start URL
main(startPageUrl).catch(console.error);
