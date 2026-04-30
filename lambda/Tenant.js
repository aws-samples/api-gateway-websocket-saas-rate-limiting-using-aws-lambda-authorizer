// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const common = require("./Common.js");

exports.handler = async(event, context) => {
    try {
        if (event.requestContext.http.method == "GET") {
            event.queryStringParameters = { tenantId: "none" };
            let dynamo = common.createDynamoDBClient(event);
            let body = await dynamo.send(new common.ScanCommand({ TableName: process.env.TenantTableName }));
            return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
        }
    }
    catch (err) {
        console.error(err);
        return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify(err.message) };
    }
}
