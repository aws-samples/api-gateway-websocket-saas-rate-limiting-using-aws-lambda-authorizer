// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

package com.amazonaws.services.sample.apigateway.websocketratelimit;

import software.amazon.awscdk.*;
import software.amazon.awscdk.customresources.AwsCustomResource;
import software.amazon.awscdk.customresources.AwsCustomResourcePolicy;
import software.amazon.awscdk.customresources.AwsSdkCall;
import software.amazon.awscdk.customresources.PhysicalResourceId;
import software.amazon.awscdk.services.apigatewayv2.*;
import software.amazon.awscdk.services.apigatewayv2.alpha.*;
import software.amazon.awscdk.services.apigatewayv2.alpha.HttpMethod;
import software.amazon.awscdk.services.apigatewayv2.integrations.alpha.HttpLambdaIntegration;
import software.amazon.awscdk.services.apigatewayv2.integrations.alpha.WebSocketLambdaIntegration;
import software.amazon.awscdk.services.dynamodb.*;
import software.amazon.awscdk.services.iam.*;
import software.amazon.awscdk.services.lambda.Runtime;
import software.amazon.awscdk.services.lambda.*;
import software.amazon.awscdk.services.lambda.eventsources.DynamoEventSource;
import software.amazon.awscdk.services.lambda.eventsources.SqsEventSource;
import software.amazon.awscdk.services.sqs.DeduplicationScope;
import software.amazon.awscdk.services.sqs.FifoThroughputLimit;
import software.amazon.awscdk.services.sqs.Queue;
import software.constructs.Construct;

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
    private Function webSocketConnectFunction;
    private Function webSocketDisconnectFunction;
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
        createWebSocketConnectLambda();
        createWebSocketDisconnectLambda();
        createAuthorizerLambda();
        createAPIGatewayWebSocket();
        createQueueWebSocketAPIRoute(true); // silo
        createQueueWebSocketAPIRoute(false); // pooled
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
                        .name("tenantId")
                        .type(AttributeType.STRING)
                        .build())
                .sortKey(Attribute.builder()
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
                .runtime(Runtime.NODEJS_14_X)
                .code(Code.fromAsset("lambda"))
                .handler("SessionTTL.handler")
                .events(List.of(DynamoEventSource.Builder.create(sessionTable).startingPosition(StartingPosition.LATEST).build()))
                .build();
    }

    private void createSampleClientLambda() {
        sampleClientFunction = Function.Builder.create(this, "SampleClientHandler")
                .runtime(Runtime.NODEJS_14_X)
                .code(Code.fromAsset("lambda"))
                .handler("SampleClientGet.handler")
                .build();
    }

    private void createSessionLambda() {
        sessionFunction = Function.Builder.create(this, "Session")
                .runtime(Runtime.NODEJS_14_X)
                .code(Code.fromAsset("lambda"))
                .handler("Session.handler")
                .build();
    }

    private void createTenantLambda() {
        tenantFunction = Function.Builder.create(this, "Tenant")
                .runtime(Runtime.NODEJS_14_X)
                .code(Code.fromAsset("lambda"))
                .handler("Tenant.handler")
                .build();
    }


    private void createWebSocketConnectLambda() {
        webSocketConnectFunction = Function.Builder.create(this, "WebSocketConnect")
                .runtime(Runtime.NODEJS_14_X)
                .code(Code.fromAsset("lambda"))
                .handler("WebSocketConnect.handler")
                .build();
    }

    private void createWebSocketDisconnectLambda() {
        webSocketDisconnectFunction = Function.Builder.create(this, "WebSocketDisconnect")
                .runtime(Runtime.NODEJS_14_X)
                .code(Code.fromAsset("lambda"))
                .handler("WebSocketDisconnect.handler")
                .build();
        sessionTable.grantReadWriteData(webSocketDisconnectFunction);
    }

    private void createAuthorizerLambda() {
        authorizerFunction = Function.Builder.create(this, "Authorizer")
                .runtime(Runtime.NODEJS_14_X)
                .code(Code.fromAsset("lambda"))
                .handler("Authorizer.handler")
                .build();
    }

    private void createAPIGatewayWebSocket() {
        // Create a websocket API endpoint with routing to our echo lambda
        // We do not create the connect route at this point due to the authorizer not being enabled for the WebSocketRouteOptions
        // yet, we will instead use the low level Cfn style functions later.
        api = WebSocketApi.Builder.create(this, "WebSocketAPIGateway")
                .apiName("WebSocketRateLimitSample")
                .description("Rate limit websocket connections using a Lambda Authorizer.")
                .disconnectRouteOptions(WebSocketRouteOptions.builder().integration(new WebSocketLambdaIntegration("WebSocketAPIGatewayDisconnectRoute",webSocketDisconnectFunction)).build())
                .build();
    }


    private void createQueueWebSocketAPIRoute(boolean silo) {
        String nameExt = silo ? "Silo" : "Pooled";
        Role apiGatewayWebSocketSQSRole = Role.Builder.create(this, "ApiGatewayWebSocket" + nameExt + "SQSRole")
                .assumedBy(ServicePrincipal.Builder.create("apigateway.amazonaws.com").build())
                .inlinePolicies(Map.of("APIGateway" + nameExt + "SQSSendMessagePolicy", PolicyDocument.Builder.create()
                                .statements(List.of(PolicyStatement.Builder.create()
                                                .effect(Effect.ALLOW)
                                                .actions(List.of("sqs:SendMessage"))
                                                .resources(List.of("arn:aws:sqs:" + getRegion() +":" + getAccount() + ":tenant-" + (silo ? "*" : nameExt) + ".fifo"))
                                        .build()))
                        .build()))
                .build();
        String requestTemplateItem = "";
        requestTemplateItem += "Action=SendMessage";
        requestTemplateItem += "&MessageGroupId=$context.authorizer.tenantId:$context.authorizer.sessionId";
        requestTemplateItem += "&MessageDeduplicationId=$context.requestId";
        requestTemplateItem += "&MessageAttribute.1.Name=tenantId&MessageAttribute.1.Value.StringValue=$context.authorizer.tenantId&MessageAttribute.1.Value.DataType=String";
        requestTemplateItem += "&MessageAttribute.2.Name=sessionId&MessageAttribute.2.Value.StringValue=$context.authorizer.sessionId&MessageAttribute.2.Value.DataType=String";
        requestTemplateItem += "&MessageAttribute.3.Name=connectionId&MessageAttribute.3.Value.StringValue=$context.connectionId&MessageAttribute.3.Value.DataType=String";
        requestTemplateItem += "&MessageAttribute.4.Name=requestId&MessageAttribute.4.Value.StringValue=$context.requestId&MessageAttribute.4.Value.DataType=String";
        requestTemplateItem += "&MessageAttribute.5.Name=sessionPerMinute&MessageAttribute.5.Value.StringValue=$context.authorizer.sessionPerMinute&MessageAttribute.5.Value.DataType=String";
        requestTemplateItem += "&MessageAttribute.6.Name=tenantPerMinute&MessageAttribute.6.Value.StringValue=$context.authorizer.tenantPerMinute&MessageAttribute.6.Value.DataType=String";
        requestTemplateItem += "&MessageAttribute.7.Name=connectionsPerSession&MessageAttribute.7.Value.StringValue=$context.authorizer.connectionsPerSession&MessageAttribute.7.Value.DataType=String";
        requestTemplateItem += "&MessageAttribute.8.Name=sessionTTL&MessageAttribute.8.Value.StringValue=$context.authorizer.sessionTTL&MessageAttribute.8.Value.DataType=String";
        requestTemplateItem += "&MessageAttribute.9.Name=tenantConnections&MessageAttribute.9.Value.StringValue=$context.authorizer.tenantConnections&MessageAttribute.9.Value.DataType=String";
        requestTemplateItem += "&MessageAttribute.10.Name=messagesPerMinute&MessageAttribute.10.Value.StringValue=$context.authorizer.messagesPerMinute&MessageAttribute.10.Value.DataType=String";
        requestTemplateItem += "&MessageBody=$input.json('$')";
        CfnIntegration integration = CfnIntegration.Builder.create(this, nameExt + "Integration")
                .apiId(api.getApiId())
                .connectionType("INTERNET")
                .integrationType("AWS")
                .credentialsArn(apiGatewayWebSocketSQSRole.getRoleArn())
                .templateSelectionExpression("\\$default")
                .integrationMethod("POST")
                .integrationUri("arn:aws:apigateway:" + getRegion() + ":sqs:path/" + getAccount() + "/tenant-{queue}.fifo")
                .passthroughBehavior("NEVER")
                .requestParameters(Map.of(
                        "integration.request.header.Content-Type",
                        "'application/x-www-form-urlencoded'",
                        "integration.request.path.queue",
                        silo ? "context.authorizer.tenantId" : "'" + nameExt + "'"))
                .requestTemplates(Map.of(
                        "$default",
                        requestTemplateItem
                ))
                .build();
        CfnRoute.Builder.create(this, nameExt + "Route")
                .apiId(api.getApiId())
                .routeKey(nameExt + "SQS")
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
                .integrationUri("arn:aws:apigateway:" + getRegion() + ":lambda:path/2015-03-31/functions/" + webSocketConnectFunction.getFunctionArn() + "/invocations")
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
        stage = WebSocketStage.Builder.create(this, "EchoWebSocketAPIGatewayProd")
                .stageName("production")
                .webSocketApi(api)
                .autoDeploy(true)
                .build();
    }

    private void createAPIGatewaySessionAndSample() {
        sessionApi = HttpApi.Builder.create(this, "SessionAndSampleAPIGateway")
                .apiName("WebSocketRateLimitSessionSample")
                .description("Creates and removes sessions and loads sample client")
                .createDefaultStage(false)
                .build();
        HttpLambdaIntegration sessionLambdaIntegration = new HttpLambdaIntegration("SessionLambdaIntegration", sessionFunction);
        HttpLambdaIntegration tenantLambdaIntegration = new HttpLambdaIntegration("TenantLambdaIntegration", tenantFunction);
        HttpLambdaIntegration sampleClientLambdaIntegration = new HttpLambdaIntegration("SampleClientLambdaIntegration", sampleClientFunction);
        sessionApi.addRoutes(AddRoutesOptions.builder()
                .methods(List.of(HttpMethod.PUT))
                .path("/session")
                .integration(sessionLambdaIntegration)
                .build());
        sessionApi.addRoutes(AddRoutesOptions.builder()
                .methods(List.of(HttpMethod.DELETE))
                .path("/session")
                .integration(sessionLambdaIntegration)
                .build());
        sessionApi.addRoutes(AddRoutesOptions.builder()
                .methods(List.of(HttpMethod.GET))
                .path("/tenant")
                .integration(tenantLambdaIntegration)
                .build());
        sessionApi.addRoutes(AddRoutesOptions.builder()
                .methods(List.of(HttpMethod.GET))
                .path("/SampleClient")
                .integration(sampleClientLambdaIntegration)
                .build());
        sessionApi.addStage("SessionApiProductionStage", HttpStageOptions.builder()
                .autoDeploy(true)
                .stageName("production")
                .build());
    }

    private void setupAPIGatewayLambdaFunctions() {
        // Update the lambdas to allow callbacks to this websocket endpoint and set environment variables to be able to reach various resources.
        // A role is created for each lambda to allow us to Assume the role with session tags to 
        Role sessionTTLLambdaTableRole = Role.Builder.create(this, "SessionTTLLambdaTableRole").assumedBy(new SessionTagsPrincipal(sessionTTLLambda.getRole())).build();
        setupWebSocketFunction(sessionTTLLambda, sessionTTLLambdaTableRole, null, true, true);
        Role webSocketConnectFunctionTableRole = Role.Builder.create(this, "WebSocketConnectFunctionTableRole").assumedBy(new SessionTagsPrincipal(webSocketConnectFunction.getRole())).build();
        setupWebSocketFunction(webSocketConnectFunction, webSocketConnectFunctionTableRole, "/*/$connect", true);
        Role webSocketDisconnectFunctionTableRole = Role.Builder.create(this, "WebSocketDisconnectFunctionTableRole").assumedBy(new SessionTagsPrincipal(webSocketDisconnectFunction.getRole())).build();
        setupWebSocketFunction(webSocketDisconnectFunction, webSocketDisconnectFunctionTableRole, "/*/$disconnect", true);
        Role authorizerFunctionTableRole = Role.Builder.create(this, "AuthorizerFunctionTableRole").assumedBy(new SessionTagsPrincipal(authorizerFunction.getRole())).build();
        setupWebSocketFunction(authorizerFunction, authorizerFunctionTableRole, "/authorizers/" + authorizer.getRef(), false);
        Role sessionFunctionTableRole = Role.Builder.create(this, "SessionFunctionTableRole").assumedBy(new SessionTagsPrincipal(sessionFunction.getRole())).build();
        setupWebSocketFunction(sessionFunction, sessionFunctionTableRole,null, false);
        Role tenantFunctionTableRole = Role.Builder.create(this, "TenantFunctionTableRole").assumedBy(new SessionTagsPrincipal(tenantFunction.getRole())).build();
        setupWebSocketFunction(tenantFunction, tenantFunctionTableRole,null, false, false);

        sampleClientFunction.addEnvironment("WssUrl", stage.getUrl());
        sampleClientFunction.addEnvironment("SessionUrl", sessionApi.getApiEndpoint() + "/production/session");
        sampleClientFunction.addEnvironment("TenantUrl", sessionApi.getApiEndpoint() + "/production/tenant");
    }

    private void setupWebSocketFunction(Function function, Role tableRole, String permissionEndpoint, boolean includePostPolicy) {
        setupWebSocketFunction(function, tableRole, permissionEndpoint, includePostPolicy, false);
    }

    private void setupWebSocketFunction(Function function, Role tableRole, String permissionEndpoint, boolean includePostPolicy, boolean includeDeletePolicy) {
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
//        function.addToRolePolicy(PolicyStatement.Builder.create()
//                .effect(Effect.ALLOW)
//                .actions(List.of("sts:AssumeRole", "sts:TagSession"))
//                .resources(List.of(tableRole.getRoleArn()))
//                .build());
        function.addEnvironment("RoleArn", tableRole.getRoleArn());
        tableRole.grantAssumeRole(function.getRole());
        tenantTable.grantReadData(tableRole).getPrincipalStatement().addCondition("ForAllValues:StringEquals", Map.of("dynamodb:LeadingKeys", List.of("${aws:PrincipalTag/tenantId}")));
        sessionTable.grantReadWriteData(tableRole).getPrincipalStatement().addCondition("ForAllValues:StringEquals", Map.of("dynamodb:LeadingKeys", List.of("${aws:PrincipalTag/tenantId}")));
        limitTable.grantReadWriteData(tableRole).getPrincipalStatement().addCondition("ForAllValues:StringLike", Map.of("dynamodb:LeadingKeys", List.of("${aws:PrincipalTag/tenantId}*")));
    }

    private void addSampleTenantIds() {
        addSampleTenantId("a5a82459-3f18-4ecd-89a6-2d13af314751", "60", "5", "2", "10", "200", "60", 1);
        addSampleTenantId("9175b21a-332a-4a7a-a72d-9184ad7186c0", "120", "10", "5", "100", "300","600",2);
        addSampleTenantId("31a2e8c6-1826-11ec-9621-0242ac130002", "180", "30", "10", "1000", "300","6000",3);
        Function sqsEchoFunction = createSQSEchoLambda("Pooled");
        createSQSFifoQueuePerTenant("Pooled", sqsEchoFunction);
    }

    private void addSampleTenantId(String tenantId, String tenantPerMinute, String sessionPerMinute, String connectionsPerSession, String tenantConnections, String sessionTTL, String messagesPerMinute, int index) {
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
                                Map.entry("tenantConnections", Map.of("N", tenantConnections)),
                                Map.entry("sessionTTL", Map.of("N", sessionTTL)),
                                Map.entry("messagesPerMinute", Map.of("N", messagesPerMinute))
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
                .runtime(Runtime.NODEJS_14_X)
                .code(Code.fromAsset("lambda"))
                .handler("SQSEcho.handler")
                .build();
        Tags.of(function).add("tenantId", tenantId);
        Role lambdaTableRole = Role.Builder.create(this, "SQSEcho" + tenantId + "TableRole").assumedBy(new SessionTagsPrincipal(function.getRole())).build();
        setupWebSocketFunction(function, lambdaTableRole, null, true);
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
