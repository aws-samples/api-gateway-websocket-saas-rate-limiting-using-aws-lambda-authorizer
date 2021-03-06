// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const fs = require('fs')

// This is a simple handler to return back the sample webpage with url values created by the cloudformation stack
exports.handler = async(event) => {
    //console.log("Sample: " + JSON.stringify(event, null, 2));

    try {
        let filename = event.queryStringParameters && event.queryStringParameters.page ? event.queryStringParameters.page : "SampleClient.html";
        const data = fs.readFileSync("./" + filename, 'utf8').replace("{{WssUrl}}", process.env.WssUrl).replace("{{sessionUrl}}", process.env.SessionUrl).replace("{{tenantUrl}}", process.env.TenantUrl);
        let contentType = filename == "SampleClient.js" ? "text/javascript" : "text/html";
        return {
            statusCode: 200,
            body: data,
            headers: { "Content-Type": contentType }
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
