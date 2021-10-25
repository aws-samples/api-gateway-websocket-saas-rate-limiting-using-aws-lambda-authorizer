// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const common = require("./Common.js");

// This handler is just a sample helper to fetch the current tenant ids from the database.
// In a production system the tenant id would typically be known to the user and a list would not be
// available as a public endpoint.
exports.handler = async(event, context) => {
    //console.log('Received event:', JSON.stringify(event, null, 2));

    try {
        if (event.requestContext.http.method == "GET") {
            event.queryStringParameters = {
                tenantId: "none"
            };
            let dynamo = common.createDynamoDBClient(event);
            let body = await dynamo.scan({ "TableName": process.env.TenantTableName }).promise();
            return {statusCode: 200, headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)};
        }
    }
    catch (err) {
        console.error(err);
        return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify(err.message) };
    }
}
