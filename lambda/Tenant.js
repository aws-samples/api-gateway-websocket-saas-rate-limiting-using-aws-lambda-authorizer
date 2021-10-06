// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const common = require("./Common.js");

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
        console.log('Error:', JSON.stringify(err, null, 2));
        return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify(err.message) };
    }
}
