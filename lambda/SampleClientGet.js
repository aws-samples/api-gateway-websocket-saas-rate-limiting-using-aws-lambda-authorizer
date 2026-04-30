// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const fs = require('fs')

// This is a simple handler to return back the sample webpage with url values created by the cloudformation stack
exports.handler = async(event) => {
    //console.log("Sample: " + JSON.stringify(event, null, 2));

    try {
        const ALLOWED_FILES = { "SampleClient.html": "text/html", "SampleClient.js": "text/javascript" };
        const requested = event.queryStringParameters && event.queryStringParameters.page ? event.queryStringParameters.page : "SampleClient.html";
        if (!ALLOWED_FILES[requested]) {
            return { statusCode: 400, body: JSON.stringify('Invalid page parameter') };
        }
        const data = fs.readFileSync("./" + requested, 'utf8').replace("{{WssUrl}}", process.env.WssUrl).replace("{{sessionUrl}}", process.env.SessionUrl).replace("{{tenantUrl}}", process.env.TenantUrl);
        return {
            statusCode: 200,
            body: data,
            headers: { "Content-Type": ALLOWED_FILES[requested] }
        };
    }
    catch (err) {
        console.error(err);
        return {
            statusCode: 500,
            body: JSON.stringify('Error: ' + JSON.stringify(err))
        };
    }
};
