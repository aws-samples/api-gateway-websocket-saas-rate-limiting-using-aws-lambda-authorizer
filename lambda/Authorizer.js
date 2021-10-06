// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const common = require("./Common.js");
let tenantSettingsCache = {}; // Defined outside the function globally

exports.handler = async function(event, context) {
    //console.log('Received event:', JSON.stringify(event, null, 2));
    let dynamo = common.createDynamoDBClient(event);
    let tenantId = common.getTenantId(event);
    let sessionId = common.getSessionId(event);
    try {
        let response;
        if (tenantId in tenantSettingsCache) {
            response = tenantSettingsCache[tenantId];
        } else {
            response = await dynamo.get({ "TableName": process.env.TenantTableName, "Key": { tenantId: tenantId } }).promise();
            if (!response || !response.Item || !response.Item.tenantId) {
                console.log(tenantId + " tenant not found");
                return common.generateDeny(event.methodArn, event);
            }
            tenantSettingsCache[tenantId] = response;
        }
        let tenantSettings = response.Item;

        // Check if session exists
        response = await dynamo.get({ "TableName": process.env.SessionTableName, "Key": { tenantId: tenantId, sessionId: sessionId } }).promise();
        if (!response || !response.Item) {
            console.log("Tenant: " + tenantId + " Session: " + sessionId + " not found: " + JSON.stringify(response, null, 2));
            return common.generateDeny(event.methodArn, event);
        }

        return common.generateAllow(event.methodArn, event, tenantSettings);
    }
    catch (err) {
        console.log("Error: " + JSON.stringify(err));
        return common.generateDeny(event.methodArn, event);
    }
}