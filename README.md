# API Gateway Websocket SaaS Rate Limiting using AWS Lambda Authorizer

When creating a SaaS multi-tenant systems which require websocket connections we need a way to rate limit those connections on a per tenant basis. 
With Amazon API Gateway you have the option to use usage plans with HTTP connections however they are not available for websockets. 
To enable rate limiting we can use a <a href="https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-use-lambda-authorizer.html">API Gateway Lambda Authorizer</a> to validate a connection and control access. 
Using a Lambda Authorizer we can implement code to allow the system to valid connection rates and throttle inbound connections on a per tenant basis.
This sample also demonstrates pool and silo modes for handling the message traffic per tenant.
The pool mode simply uses a single AWS Lambda to process all inbound messages using the authorization context to handle tenant isolation.
The silo mode uses Amazon SQS to enable per tenant FIFO queue message ordering. 
An Amazon SQS queue and AWS Lambda function is create for each tenant to allow for per tenant throttling and FIFO queue isolation per session of a tenant.

## Architecture
<img alt="Architecture" src="./images/architecture.png" />

1. The client send an HTTP PUT request to the Amazon API Gateway HTTP endpoint to create a session for a tenant. This call could also be authenticated if required but that is outside the scope of this sample.
2. The session AWS Lambda will create a session and store it in the DynamoDB with a TTL (Time To Live) value specified which will remove all session connections if no communication is sent or received over a specific period of time.
3. Once a session is created the client will initiate a websocket connection to the Amazon AWS API Gateway websocket endpoint.
4. An AWS Lambda function is used as the Authorizer for the websocket connection. The authorizer will do the following:
    1. Add the tenantId and sessionId to the authorizer context
    2. Validate the tenant exists
    3. Validate the session exists
    4. Check if the system is over the total number of <b>connections</b> allowed for this <b>tenant</b>
    5. Check if the system is over the total number of <b>connections</b> allowed for this <b>session</b>
    6. Check if the system is over the total number of <b>connections per minute</b> allowed for the <b>tenant</b>
    7. Check if the system is over the total number of <b>connections per minute</b> allowed for the <b>session</b>
5. An AWS Lambda function is used during connect to update the sessions connectionId set and increment the total number of connections for the tenant. This also updates the session TTL.
6. Messages are processed as either silo or pooled depending on the route selected 
   <ol style="list-style-type: lower-alpha">To process message per tenant in silo mode with FIFO, messages are sent to the tenants corresponding SQS FIFO queue with the tenant, session, and connection ids as metadata.</ol>
   <ol style="list-style-type: lower-alpha">An AWS Lambda function per tenant is used to read messages from the SQS FIFO queue with session based grouping to keep messages in order.</ol>
   <ol style="list-style-type: lower-alpha">An AWS Lambda function is invoked for each message received by a websocket connection. The Lambda will respond by echoing the message back to the sender. The Lambda will also send the inbound message AND the response to all other connectionIds for the same session. Each inbound message will also update the session TTL.</ol>
7. An AWS Lambda function is used during disconnect to remove the connectionId from the sessions connectionId set and also decrement the total number of connections for the tenant.
8. Once all connections are closed the client will send an HTTP DELETE request to the Amazon API Gateway HTTP endpoint to remove the session.
9. An AWS Lambda function is used to process all DynamoDB stream updates. This function will check for TTL events and remove connections for sessions that expire.

## Silo vs Pooled Message processing
SQS queues are used in silo mode and the API gateway will use the authorization contexts tenantId to determine the queue name per tenant.


## DynamoDB Table Structures
All tables access is restricted by a partition key condition to only allow access to rows for which the primary index matches the current tenantId.

#### Tenant Table
The tenant table is used to store the tenantIds and option details to allow each tenant to specify different rate limits.

Fields
1. tenantId (String) (Partition Key) - The tenantId
2. connectionsPerSession (Number) - The max number of connections each session is allowed
3. tenantConnections (Number) - The max number of connections this tenant is allowed
4. sessionPerMinute (Number) - The max number of connections per minute for a session
5. tenantPerMinute (Number) - The max number of connections per minute for this tenant

#### Limit Table
The limit table is used to store the current limit counts for each tenant and also the per minute counts.

Fields
1. key (String) (Partition Key) - This key field can be one of three formats
    1. tenantId - If the key is a single tenantId then it is tracking the total number of connections for this tenant
    2. tenantId:minute:{epoch} - If the key is the tenantId:minute:{epoch} then it is tracking the current number of connections per minute for the tenant within the {epoch} value start time + 60 seconds.
    3. tenantId:sessionId:minute:{epoch} - If the key is the tenantId:sessionId:minute:{epoch} then it is tracking the current number of connections per minute for the session within the {epoch} value start time + 60 seconds.
2. itemCount (Number) - The current value for the limit
3. itemTTL (Number) (TTL) - The time to live value for DynamoDB to remove this item. This is used for the per minute connection rates to remove expired rows.

#### Session Table
The session table keeps track of sessions per tenant and will expire sessions after a set amount of time

Fields
1. tenantId (String) (Partition Key) - The tenantId
2. sessionId (String) (Sort Key) - The sessionId
3. connectionIds (Set [String]) - The current connectionIds for this session. This is used to keep track of the number of connections per session. It is also used to send reply messages to all connections on a specific session.
4. sessionTTL (Number) (TTL) - the time to live value for DynamoDB to remove this item. This value is used to removed expired sessions and disconnect any lingering connections associated.

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.