// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const { ApiGatewayManagementApiClient, DeleteConnectionCommand } = require("@aws-sdk/client-apigatewaymanagementapi");
const apig = new ApiGatewayManagementApiClient({ endpoint: "https://" + process.env.ApiGatewayEndpoint });

exports.handler = async function(event, context) {
    for (let x = 0; x < event.Records.length; x++) {
        const record = event.Records[x];
        if (record.userIdentity && record.userIdentity.principalId == "dynamodb.amazonaws.com" && record.userIdentity.type == "Service") {
            if (record.eventName == 'REMOVE' && record.dynamodb && record.dynamodb.OldImage && record.dynamodb.OldImage.connectionIds) {
                let connectionIds = record.dynamodb.OldImage.connectionIds.SS;
                for (let y = 0; y < connectionIds.length; y++) {
                    try {
                        await apig.send(new DeleteConnectionCommand({ ConnectionId: connectionIds[y] }));
                    }
                    catch (err) {
                        console.error(err);
                    }
                }
            }
        }
    }
    return { statusCode: 200 };
};
