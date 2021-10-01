package com.amazonaws.services.sample.apigateway.websocketratelimit;

import software.amazon.awscdk.core.App;
import software.amazon.awscdk.core.StackProps;

public class RateLimitApp {
    public static void main(final String[] args) {
        App app = new App();

        new RateLimitStack(app, "APIGatewayWebsocketRateLimitStack", StackProps.builder()
                .stackName("APIGatewayWebsocketRateLimit")
                .build());

        app.synth();
    }
}
