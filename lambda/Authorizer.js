// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const common = require("./Common.js");
let tenantSettingsCache = {};

exports.handler = async function(event, context) {
    let dynamo = common.createDynamoDBClient(event);
    let tenantId = common.getTenantId(event);
    let sessionId = common.getSessionId(event);
    try {
        let response;
        if (tenantId in tenantSettingsCache) {
            response = tenantSettingsCache[tenantId];
        } else {
            response = await dynamo.send(new common.GetCommand({ TableName: process.env.TenantTableName, Key: { tenantId } }));
            if (!response || !response.Item || !response.Item.tenantId) {
                console.log(tenantId + " tenant not found");
                return common.generateDeny(event.methodArn, event);
            }
            tenantSettingsCache[tenantId] = response;
        }

        let sessionResponse = await dynamo.send(new common.GetCommand({ TableName: process.env.SessionTableName, Key: { tenantId, sessionId } }));
        if (!sessionResponse || !sessionResponse.Item) {
            console.log("Tenant: " + tenantId + " Session: " + sessionId + " not found");
            return common.generateDeny(event.methodArn, event);
        }

        return common.generateAllow(event.methodArn, event, response.Item);
    }
    catch (err) {
        console.error(err);
        return common.generateDeny(event.methodArn, event);
    }
}
