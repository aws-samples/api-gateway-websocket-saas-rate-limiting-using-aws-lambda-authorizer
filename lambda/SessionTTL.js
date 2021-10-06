// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const AWS = require("aws-sdk");
const apig = new AWS.ApiGatewayManagementApi({ endpoint: process.env.ApiGatewayEndpoint });

exports.handler = async function(event, context) {
    //console.log(JSON.stringify(event));
    for (let x = 0; x < event.Records.length; x++) {
        const record = event.Records[x];
        if (record.userIdentity && record.userIdentity.principalId && record.userIdentity.type && record.userIdentity.principalId == "dynamodb.amazonaws.com" && record.userIdentity.type == "Service") {
            if (record.eventName == 'REMOVE' && record.dynamodb && record.dynamodb.OldImage && record.dynamodb.OldImage.connectionIds) {
                let connectionIds = record.dynamodb.OldImage.connectionIds.SS;
                for (let y = 0; y < connectionIds.length; y++) {
                    const connectionId = connectionIds[y];
                    //console.log("SessionTTL Removing ConnectionId: " + connectionId);
                    try {
                        await apig.deleteConnection({ ConnectionId: connectionId }).promise();
                    }
                    catch (err) {
                        console.error(err);
                    }
                };
            }
        }
    }
    return { statusCode: 200 };
};
