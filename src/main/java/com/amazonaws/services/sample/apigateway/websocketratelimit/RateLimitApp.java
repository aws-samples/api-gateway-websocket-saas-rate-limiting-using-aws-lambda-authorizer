// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

package com.amazonaws.services.sample.apigateway.websocketratelimit;

import software.amazon.awscdk.core.App;
import software.amazon.awscdk.core.StackProps;

public class RateLimitApp {
    public static void main(final String[] args) {
        App app = new App();

        new RateLimitStack(app, "APIGatewayWebSocketRateLimitStack", StackProps.builder()
                .stackName("APIGatewayWebSocketRateLimit")
                .build());

        app.synth();
    }
}
