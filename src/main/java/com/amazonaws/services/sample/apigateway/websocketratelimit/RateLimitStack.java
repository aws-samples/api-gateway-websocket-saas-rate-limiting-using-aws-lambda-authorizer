// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

package com.amazonaws.services.sample.apigateway.websocketratelimit;

import software.amazon.awscdk.core.*;
import software.amazon.awscdk.customresources.AwsCustomResource;
import software.amazon.awscdk.customresources.AwsCustomResourcePolicy;
import software.amazon.awscdk.customresources.AwsSdkCall;
import software.amazon.awscdk.customresources.PhysicalResourceId;
import software.amazon.awscdk.services.apigatewayv2.*;
import software.amazon.awscdk.services.apigatewayv2.integrations.LambdaProxyIntegration;
import software.amazon.awscdk.services.apigatewayv2.integrations.LambdaWebSocketIntegration;
import software.amazon.awscdk.services.dynamodb.*;
import software.amazon.awscdk.services.iam.*;
import software.amazon.awscdk.services.lambda.Runtime;
import software.amazon.awscdk.services.lambda.*;
import software.amazon.awscdk.services.lambda.eventsources.DynamoEventSource;
import software.amazon.awscdk.services.lambda.eventsources.SqsEventSource;
import software.amazon.awscdk.services.sqs.DeduplicationScope;
import software.amazon.awscdk.services.sqs.FifoThroughputLimit;
import software.amazon.awscdk.services.sqs.Queue;

import java.util.List;
import java.util.Map;

public class RateLimitStack extends Stack {
    private Table tenantTable;
    private Table sessionTable;
    private Table limitTable;
    private Function sessionTTLLambda;
    private Function sampleClientFunction;
    private Function sessionFunction;
    private Function tenantFunction;
    private Function websocketConnectFunction;
    private Function websocketDisconnectFunction;
    private Function websocketEchoFunction;
    private Function authorizerFunction;
    private WebSocketApi api;
    private HttpApi sessionApi;
    private CfnAuthorizer authorizer;
    private WebSocketStage stage;

    public RateLimitStack(final Construct scope, final String id) {
        this(scope, id, null);
    }

    public RateLimitStack(final Construct scope, final String id, final StackProps props) {
        super(scope, id, props);

        createTenantDynamoDBTable();
        createSessionDynamoDBTable();
        createLimitDynamoDBTable();
        createSessionTTLLambda();
        createSampleClientLambda();
        createSessionLambda();
        createTenantLambda();
        createWebsocketConnectLambda();
        createWebsocketDisconnectLambda();
        createWebsocketEchoLambda();
        createAuthorizerLambda();
        createAPIGatewayWebsocket();
        createPerTenantQueueWebsocketAPIRoute();
        createAuthorizer();
        createConnectIntegration();
        createStage();
        createAPIGatewaySessionAndSample();
        setupAPIGatewayLambdaFunctions();
        addSampleTenantIds();
        createOutputs();
    }

    private void createTenantDynamoDBTable() {
        tenantTable = Table.Builder.create(this, "TenantTable")
                .removalPolicy(RemovalPolicy.DESTROY)
                .partitionKey(Attribute.builder()
                        .name("tenantId")
                        .type(AttributeType.STRING)
                        .build())
                .build();

        EnableScalingProps esp = EnableScalingProps.builder().maxCapacity(10).minCapacity(1).build();
        tenantTable.autoScaleReadCapacity(esp).scaleOnUtilization(UtilizationScalingProps.builder().targetUtilizationPercent(70).build());
        tenantTable.autoScaleWriteCapacity(esp).scaleOnUtilization(UtilizationScalingProps.builder().targetUtilizationPercent(70).build());
    }

    private void createSessionDynamoDBTable() {
        sessionTable = Table.Builder.create(this, "SessionTable")
                .removalPolicy(RemovalPolicy.DESTROY)
                .partitionKey(Attribute.builder()
                        .name("tenantId")
                        .type(AttributeType.STRING)
                        .build())
                .sortKey(Attribute.builder()
                        .name("sessionId")
                        .type(AttributeType.STRING)
                        .build())
                .stream(StreamViewType.NEW_AND_OLD_IMAGES)
                .timeToLiveAttribute("sessionTTL")
                .build();

        EnableScalingProps esp = EnableScalingProps.builder().maxCapacity(10).minCapacity(1).build();
        sessionTable.autoScaleReadCapacity(esp).scaleOnUtilization(UtilizationScalingProps.builder().targetUtilizationPercent(70).build());
        sessionTable.autoScaleWriteCapacity(esp).scaleOnUtilization(UtilizationScalingProps.builder().targetUtilizationPercent(70).build());
    }

    private void createLimitDynamoDBTable() {
        limitTable = Table.Builder.create(this, "LimitTable")
                .removalPolicy(RemovalPolicy.DESTROY)
                .partitionKey(Attribute.builder()
                        .name("key")
                        .type(AttributeType.STRING)
                        .build())
                .timeToLiveAttribute("itemTTL")
                .build();
        EnableScalingProps esp = EnableScalingProps.builder().maxCapacity(10).minCapacity(1).build();
        limitTable.autoScaleReadCapacity(esp).scaleOnUtilization(UtilizationScalingProps.builder().targetUtilizationPercent(70).build());
        limitTable.autoScaleWriteCapacity(esp).scaleOnUtilization(UtilizationScalingProps.builder().targetUtilizationPercent(70).build());
    }

    private void createSessionTTLLambda() {
        sessionTTLLambda = Function.Builder.create(this, "SessionTTLLambda")
                .runtime(Runtime.NODEJS_12_X)
                .code(Code.fromAsset("lambda"))
                .handler("SessionTTL.handler")
                .events(List.of(DynamoEventSource.Builder.create(sessionTable).startingPosition(StartingPosition.LATEST).build()))
                .build();
    }

    private void createSampleClientLambda() {
        sampleClientFunction = Function.Builder.create(this, "SampleClientHandler")
                .runtime(Runtime.NODEJS_12_X)
                .code(Code.fromAsset("lambda"))
                .handler("SampleClientGet.handler")
                .build();
    }

    private void createSessionLambda() {
        sessionFunction = Function.Builder.create(this, "Session")
                .runtime(Runtime.NODEJS_12_X)
                .code(Code.fromAsset("lambda"))
                .handler("Session.handler")
                .build();
    }

    private void createTenantLambda() {
        tenantFunction = Function.Builder.create(this, "Tenant")
                .runtime(Runtime.NODEJS_12_X)
                .code(Code.fromAsset("lambda"))
                .handler("Tenant.handler")
                .build();
    }


    private void createWebsocketConnectLambda() {
        websocketConnectFunction = Function.Builder.create(this, "WebsocketConnect")
                .runtime(Runtime.NODEJS_12_X)
                .code(Code.fromAsset("lambda"))
                .handler("WebsocketConnect.handler")
                .build();
    }

    private void createWebsocketDisconnectLambda() {
        websocketDisconnectFunction = Function.Builder.create(this, "WebsocketDisconnect")
                .runtime(Runtime.NODEJS_12_X)
                .code(Code.fromAsset("lambda"))
                .handler("WebsocketDisconnect.handler")
                .build();
        sessionTable.grantReadWriteData(websocketDisconnectFunction);
    }

    private void createWebsocketEchoLambda() {
        websocketEchoFunction = Function.Builder.create(this, "WebsocketEcho")
                .runtime(Runtime.NODEJS_12_X)
                .code(Code.fromAsset("lambda"))
                .handler("WebsocketEcho.handler")
                .build();
    }

    private void createAuthorizerLambda() {
        authorizerFunction = Function.Builder.create(this, "Authorizer")
                .runtime(Runtime.NODEJS_12_X)
                .code(Code.fromAsset("lambda"))
                .handler("Authorizer.handler")
                .build();
    }

    private void createAPIGatewayWebsocket() {
        // Create a websocket API endpoint with routing to our echo lambda
        // We do not create the connect route at this point due to the authorizer not being enabled for the WebSocketRouteOptions
        // yet, we will instead use the low level Cfn style functions later.
        api = WebSocketApi.Builder.create(this, "WebsocketAPIGateway")
                .apiName("WebsocketRateLimitSample")
                .description("Rate limit websocket connections using a Lambda Authorizer.")
                .disconnectRouteOptions(WebSocketRouteOptions.builder()
                        .integration(LambdaWebSocketIntegration.Builder.create()
                                .handler(websocketDisconnectFunction)
                                .build())
                        .build())
                .defaultRouteOptions(WebSocketRouteOptions.builder()
                        .integration(LambdaWebSocketIntegration.Builder.create()
                                .handler(websocketEchoFunction)
                                .build())
                        .build())
                .build();
    }

    private void createPerTenantQueueWebsocketAPIRoute() {
        Role apiGatewayWebsocketSQSRole = Role.Builder.create(this, "ApiGatewayWebsocketSQSRole")
                .assumedBy(ServicePrincipal.Builder.create("apigateway.amazonaws.com").build())
                .inlinePolicies(Map.of("APIGatewaySQSSendMessagePolicy", PolicyDocument.Builder.create()
                                .statements(List.of(PolicyStatement.Builder.create()
                                                .effect(Effect.ALLOW)
                                                .actions(List.of("sqs:SendMessage"))
                                                .resources(List.of("arn:aws:sqs:" + getRegion() +":" + getAccount() + ":tenant-*.fifo"))
                                        .build()))
                        .build()))
                .build();
        CfnIntegration integration = CfnIntegration.Builder.create(this, "Integration")
                .apiId(api.getApiId())
                .connectionType("INTERNET")
                .integrationType("AWS")
                .credentialsArn(apiGatewayWebsocketSQSRole.getRoleArn())
                .integrationMethod("POST")
                .integrationUri("arn:aws:apigateway:" + getRegion() + ":sqs:path/" + getAccount() + "/tenant-{queue}.fifo")
                .passthroughBehavior("NEVER")
                .requestParameters(Map.of(
                        "integration.request.header.Content-Type",
                        "'application/x-www-form-urlencoded'",
                        "integration.request.path.queue",
                        "context.authorizer.tenantId"))
                .requestTemplates(Map.of(
                        "application/json",
                        "Action=SendMessage&MessageGroupId=$context.authorizer.sessionId&MessageDeduplicationId=$input.path('$.messageDeduplicationId')&MessageAttribute.1.Name=tenantId&MessageAttribute.1.Value.StringValue=$context.authorizer.tenantId&MessageAttribute.1.Value.DataType=String&MessageAttribute.2.Name=sessionId&MessageAttribute.2.Value.StringValue=$context.authorizer.sessionId&MessageAttribute.2.Value.DataType=String&MessageAttribute.3.Name=connectionId&MessageAttribute.3.Value.StringValue=$context.connectionId&MessageAttribute.3.Value.DataType=String&MessageBody=$input.json('$')"
                ))
                .build();
        CfnRoute.Builder.create(this, "PerTenantQueueRoute")
                .apiId(api.getApiId())
                .routeKey("PerTenantSQS")
                .target("integrations/" + integration.getRef())
                .build();
    }

    private void createAuthorizer() {
        authorizer = CfnAuthorizer.Builder.create(this, "RateLimitAuthorizer")
                .identitySource(List.of("route.request.querystring.tenantId", "route.request.querystring.sessionId"))
                .authorizerType("REQUEST")
                .authorizerUri("arn:aws:apigateway:" + getRegion() + ":lambda:path/2015-03-31/functions/" + authorizerFunction.getFunctionArn() + "/invocations")
                .apiId(api.getApiId())
                .name("RateLimitAuthorizer")
                .build();
    }

    private void createConnectIntegration() {
        CfnIntegration integration = CfnIntegration.Builder.create(this, "ConnectLambdaIntegration")
                .integrationType("AWS_PROXY")
                .integrationMethod("POST")
                .integrationUri("arn:aws:apigateway:" + getRegion() + ":lambda:path/2015-03-31/functions/" + websocketConnectFunction.getFunctionArn() + "/invocations")
                .apiId(api.getApiId())
                .build();

        CfnRoute.Builder.create(this, "ConnectRoute")
                .apiId(api.getApiId())
                .routeKey("$connect")
                .authorizationType("CUSTOM")
                .target("integrations/" + integration.getRef())
                .authorizerId(authorizer.getRef())
                .build();
    }

    private void createStage() {
        // Setup a production stage with auto deploy which will make sure we are ready to run as soon as the cloudformation stack completes
        stage = WebSocketStage.Builder.create(this, "EchoWebsocketAPIGatewayProd")
                .stageName("production")
                .webSocketApi(api)
                .autoDeploy(true)
                .build();
    }

    private void createAPIGatewaySessionAndSample() {
        sessionApi = HttpApi.Builder.create(this, "SessionAndSampleAPIGateway")
                .apiName("WebsocketRateLimitSessionSample")
                .description("Creates and removes sessions and loads sample client")
                .createDefaultStage(false)
                .build();
        sessionApi.addRoutes(AddRoutesOptions.builder()
                .methods(List.of(HttpMethod.PUT))
                .path("/session")
                .integration(LambdaProxyIntegration.Builder.create()
                        .handler(sessionFunction)
                        .build())
                .build());
        sessionApi.addRoutes(AddRoutesOptions.builder()
                .methods(List.of(HttpMethod.DELETE))
                .path("/session")
                .integration(LambdaProxyIntegration.Builder.create()
                        .handler(sessionFunction)
                        .build())
                .build());
        sessionApi.addRoutes(AddRoutesOptions.builder()
                .methods(List.of(HttpMethod.GET))
                .path("/tenant")
                .integration(LambdaProxyIntegration.Builder.create()
                        .handler(tenantFunction)
                        .build())
                .build());
        sessionApi.addRoutes(AddRoutesOptions.builder()
                .methods(List.of(HttpMethod.GET))
                .path("/SampleClient")
                .integration(LambdaProxyIntegration.Builder.create()
                        .handler(sampleClientFunction)
                        .build())
                .build());
        sessionApi.addStage("SessionApiProductionStage", HttpStageOptions.builder()
                .autoDeploy(true)
                .stageName("production")
                .build());
    }

    private void setupAPIGatewayLambdaFunctions() {
        // Update the lambdas to allow callbacks to this websocket endpoint and set environment variables to be able to reach various resources.
        setupWebsocketFunction(sessionTTLLambda, null, true, true);
        setupWebsocketFunction(websocketConnectFunction, "/*/$connect", true);
        setupWebsocketFunction(websocketDisconnectFunction, "/*/$disconnect", true);
        setupWebsocketFunction(websocketEchoFunction, "/*/$default", true);
        setupWebsocketFunction(authorizerFunction, "/authorizers/" + authorizer.getRef(), false);
        setupWebsocketFunction(sessionFunction, null, false);
        setupWebsocketFunction(tenantFunction, null, false, false);

        sampleClientFunction.addEnvironment("WssUrl", stage.getUrl());
        sampleClientFunction.addEnvironment("SessionUrl", sessionApi.getApiEndpoint() + "/production/session");
        sampleClientFunction.addEnvironment("TenantUrl", sessionApi.getApiEndpoint() + "/production/tenant");
    }

    private void setupWebsocketFunction(Function function, String permissionEndpoint, boolean includePostPolicy) {
        setupWebsocketFunction(function, permissionEndpoint, includePostPolicy, false);
    }

    private void setupWebsocketFunction(Function function, String permissionEndpoint, boolean includePostPolicy, boolean includeDeletePolicy) {
        function.addEnvironment("ApiGatewayEndpoint", stage.getUrl().replace("wss://", ""));
        function.addEnvironment("TenantTableName", tenantTable.getTableName());
        function.addEnvironment("SessionTableName", sessionTable.getTableName());
        function.addEnvironment("LimitTableName", limitTable.getTableName());
        if (includePostPolicy) {
            function.addToRolePolicy(PolicyStatement.Builder.create()
                    .actions(List.of("execute-api:ManageConnections"))
                    .resources(List.of(formatArn(ArnComponents.builder()
                            .resource(api.getApiId())
                            .service("execute-api")
                            .resourceName(stage.getStageName() + "/POST/*")
                            .build())))
                    .build());
        }
        if (includeDeletePolicy) {
            function.addToRolePolicy(PolicyStatement.Builder.create()
                    .actions(List.of("execute-api:ManageConnections"))
                    .resources(List.of(formatArn(ArnComponents.builder()
                            .resource(api.getApiId())
                            .service("execute-api")
                            .resourceName(stage.getStageName() + "/DELETE/*")
                            .build())))
                    .build());
        }
        if (permissionEndpoint != null) {
            function.addPermission("APIGatewayConnect", Permission.builder()
                    .action("lambda:InvokeFunction")
                    .principal(ServicePrincipal.Builder.create("apigateway.amazonaws.com").build())
                    .sourceArn("arn:aws:execute-api:" + getRegion() + ":" + getAccount() + ":" + api.getApiId() + permissionEndpoint)
                    .build());
        }
        function.addToRolePolicy(PolicyStatement.Builder.create()
                .effect(Effect.ALLOW)
                .actions(List.of("sts:AssumeRole", "sts:TagSession"))
                .resources(List.of(function.getRole().getRoleArn()))
                .build());
        function.addEnvironment("RoleArn", function.getRole().getRoleArn());

        tenantTable.grantReadData(function).getPrincipalStatement().addCondition("ForAllValues:StringEquals", Map.of("dynamodb:LeadingKeys", List.of("${aws:PrincipalTag/tenantId}")));
        sessionTable.grantReadWriteData(function).getPrincipalStatement().addCondition("ForAllValues:StringEquals", Map.of("dynamodb:LeadingKeys", List.of("${aws:PrincipalTag/tenantId}")));
        limitTable.grantReadWriteData(function).getPrincipalStatement().addCondition("ForAllValues:StringLike", Map.of("dynamodb:LeadingKeys", List.of("${aws:PrincipalTag/tenantId}*")));
    }

    private void addSampleTenantIds() {
        addSampleTenantId("a5a82459-3f18-4ecd-89a6-2d13af314751", "60", "5", "2", "10", 1);
        addSampleTenantId("9175b21a-332a-4a7a-a72d-9184ad7186c0", "120", "10", "5", "100", 2);
        addSampleTenantId("31a2e8c6-1826-11ec-9621-0242ac130002", "180", "30", "10", "1000", 3);
    }

    private void addSampleTenantId(String tenantId, String tenantPerMinute, String sessionPerMinute, String connectionsPerSession, String tenantConnections, int index) {
        AwsSdkCall initializeData = AwsSdkCall.builder()
                .service("DynamoDB")
                .action("putItem")
                .physicalResourceId(PhysicalResourceId.of(tenantTable.getTableName() + "_initialization" + index))
                .parameters(Map.ofEntries(
                        Map.entry("TableName", tenantTable.getTableName()),
                        Map.entry("Item", Map.ofEntries(
                                Map.entry("tenantId", Map.of("S", tenantId)),
                                Map.entry("tenantPerMinute", Map.of("N", tenantPerMinute)),
                                Map.entry("sessionPerMinute", Map.of("N", sessionPerMinute)),
                                Map.entry("connectionsPerSession", Map.of("N", connectionsPerSession)),
                                Map.entry("tenantConnections", Map.of("N", tenantConnections))
                        )),
                        Map.entry("ConditionExpression", "attribute_not_exists(tenantId)")
                ))
                .build();

        AwsCustomResource tableInitializationResource = AwsCustomResource.Builder.create(this, "TenantSampleDataTableInitializationResource" + index)
                .policy(AwsCustomResourcePolicy.fromStatements(List.of(
                        PolicyStatement.Builder.create()
                                .effect(Effect.ALLOW)
                                .actions(List.of("dynamodb:PutItem"))
                                .resources(List.of(tenantTable.getTableArn()))
                                .build()
                )))
                .onCreate(initializeData)
                .build();
        tableInitializationResource.getNode().addDependency(tenantTable);
        Function sqsEchoFunction = createSQSEchoLambda(tenantId);
        createSQSFifoQueuePerTenant(tenantId, sqsEchoFunction);
    }

    private Function createSQSEchoLambda(String tenantId) {
        Function function = Function.Builder.create(this, "SQSEcho" + tenantId)
                .runtime(Runtime.NODEJS_12_X)
                .code(Code.fromAsset("lambda"))
                .handler("SQSEcho.handler")
                .build();
        Tags.of(function).add("tenantId", tenantId);
        setupWebsocketFunction(function, null, true);
        return function;
    }

    private void createSQSFifoQueuePerTenant(String tenantId, Function sqsEchoFunction) {
        Queue tenantQueue = Queue.Builder.create(this, "TenantQueue" + tenantId)
                .fifo(true)
                .fifoThroughputLimit(FifoThroughputLimit.PER_MESSAGE_GROUP_ID)
                .deduplicationScope(DeduplicationScope.MESSAGE_GROUP)
                .queueName("tenant-" + tenantId + ".fifo")
                .build();
        Tags.of(tenantQueue).add("tenantId", tenantId);
        sqsEchoFunction.addEventSource(SqsEventSource.Builder.create(tenantQueue).enabled(true).build());
    }

    private void createOutputs() {
        CfnOutput.Builder.create(this, "SessionURL")
                .exportName("SessionURL")
                .value(sessionApi.getApiEndpoint() + "/production/session")
                .build();
        CfnOutput.Builder.create(this, "TenantURL")
                .exportName("TenantURL")
                .value(sessionApi.getApiEndpoint() + "/production/tenant")
                .build();
        CfnOutput.Builder.create(this, "WebSocketURL")
                .exportName("WebSocketURL")
                .value(stage.getUrl())
                .build();
        CfnOutput.Builder.create(this, "SampleClient")
                .exportName("SampleClient")
                .value(sessionApi.getApiEndpoint() + "/production/SampleClient")
                .build();
    }
}
