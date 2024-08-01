const util = require("util");
const exec = util.promisify(require("child_process").exec);
const fs = require("fs");
const path = require("path");
const AWS = require("aws-sdk");
const yaml = require("yaml");

// const pkgs = ["aws", "aws-native", "azure", "azure-native", "gcp", "google-native", "kubernetes", "aiven"];
const pkgs = getPackagesMetadata().slice(0,3);

const results = {
    tests: 0,
    passes: 0,
    failures: 0,
    start: 0,
    end: 0,
    duration: 0,
    failedPages: [],
    failedPageCount: 0,
    totalPageCount: 0,
};

const testRuns = pkgs.map((pkgMetadata) => {
    return exec(`npm run test-api-docs -- --pkg=${pkgMetadata.name} || true`).then(
        (stdout, stderr) => {
            const pkgType = resolvePackageType(pkgMetadata);
            console.log(stdout);
            processJSON(stdout, stderr, pkgMetadata.name, pkgType);
        },
    );
});

Promise.all(testRuns).then(async () => {
    console.log(results);
    await pushResultsS3(results);
});

function processJSON(stdout, stderr, pkg, pkgType) {
    const contents = fs.readFileSync("ctrf/ctrf-report.json", {
        encoding: "utf8",
    });
    const results = JSON.parse(contents);
    transformResults(results, pkg, pkgType);

    // The cli command error is trapped here since it is a sub process of this script.
    // Checking if error here will enable us to mark this as a failed run by exiting
    // unsuccessfully. Otherwise the run will always pass successfully regardless of
    // the result of the tests.
    if (stderr) {
        console.error("errors:", stderr);
        process.exit(1);
    }
}

function transformResults(res, pkg, pkgType) {
    const summary = res.results.summary;
    results.tests += summary.tests;
    results.passes += summary.passed;
    results.failures += summary.failed;
    results.start = summary.start;
    results.end = summary.stop;
    results.duration = summary.stop - summary.start;
    results.ghRunURL = getRunUrl();

    const allPages = {}
    res.results.tests
    .forEach((p) => {
        allPages[p.name] = 0
    });

    // Get list of failed pages.
    const failedPages = [];
    // iterate over test failures and add page url to failedPages array.
    res.results.tests
        .filter((t) => t.status !== "passed")
        .forEach((f) => {
            const {url, description} = extractTestInfo(f.name);
            failedPages.push({
                url, description 
            });
        });

    // dedupe pages and keep track of a count for each page failure occurance to map
    // the page to the number of failure occurances for each page.
    const pageMap = {};
    failedPages.forEach((page) => {
        pageMap[page.url] = {
            count: pageMap[page.url] ? pageMap[page.url].count + 1 : 1,
            failureMsg: pageMap[page.url] ? (pageMap[page.url].failureMsg || "") + " | " + page.description : page.description,
        }
    });

    // Convert pageMap to an array of objects with failure counts. This
    results.failedPages = [
        ...results.failedPages,
        ...Object.keys(pageMap).map((key) => ({
            page: key,
            failures: pageMap[key].count,
            reason:  pageMap[key].failureMsg,
            tests: 15,
            package: pkg,
            type: pkgType,
        })),
    ];

    results.failedPageCount =
        Object.keys(pageMap).length + results.failedPageCount;
    results.totalPageCount = Object.keys(allPages).length + results.totalPageCount;
    return results;
}

function extractTestInfo(msg) {
    const urlRegex = /^(https?:\/\/[^)]+\/)/;
    const match = msg.match(urlRegex);
    const url = match ? match[0] : null;
    const description = msg.replace(url, "");
    return {url, description};
}

function getRunUrl() {
    const serverUrl = process.env.GITHUB_SERVER_URL;
    const repo = process.env.GITHUB_REPOSITORY;
    const runId = process.env.GITHUB_RUN_ID;
    const runAttempt = process.env.GITHUB_RUN_ATTEMPT;

    return (
        serverUrl +
        "/" +
        repo +
        "/actions/runs/" +
        runId +
        "/attempts/" +
        runAttempt
    );
}

// expand date string to return yyyy, mm, dd
function expandDate(dateString) {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const monthNumber = date.getMonth() + 1; // zero indexed, so add 1 to get month number
    const month = `${monthNumber < 10 ? `0${monthNumber}` : monthNumber}`;
    const dayNumber = date.getDate();
    const day = `${dayNumber < 10 ? `0${dayNumber}` : dayNumber}`;
    return { year, month, day };
}

// upload to S3 with yyyy/mm/dd prefix.
async function pushResultsS3(obj) {
    const bucketName = "pulumi-api-docs-e2e-test-results-prodution";

    const jsonData = JSON.stringify(obj);
    // extract yyyy, mm, dd from date.
    const { year, month, day } = expandDate(obj.start);

    // Write JSON to file
    const filename = "results.json";
    fs.writeFileSync(filename, jsonData);

    // Upload JSON file to S3 bucket
    console.log("pushing to S3");
    const s3 = new AWS.S3();
    const key = `${year}/${month}/${day}/results.json`;

    const uploadParams = {
        Bucket: bucketName,
        Key: key,
        Body: fs.createReadStream(filename),
    };

    return s3.upload(uploadParams).promise();
}

function getPackagesMetadata() {
    const dirPath = "./themes/default/data/registry/packages/";
    const files = fs.readdirSync(dirPath);
    const yamlFiles = files.filter(file => file.endsWith('.yaml'));
    const packageMetadata = [];

    yamlFiles.forEach(file => {
        const filePath = path.join(dirPath, file);
        const fileContents = fs.readFileSync(filePath, 'utf8');
        const jsonObject = yaml.parse(fileContents);
        packageMetadata.push(jsonObject);
    });

    return packageMetadata;
}

function resolvePackageType(pkg) {
    const isComponent = pkg.component;
    const isNative = pkg.native;

    if (isComponent) {
        return "component";
    } else if (isNative) {
        return "native";
    } else {
        return "bridged";
    }
}

console.log(getPackagesMetadata());