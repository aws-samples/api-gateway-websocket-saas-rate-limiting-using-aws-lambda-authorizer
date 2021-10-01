const fs = require('fs')

exports.handler = async(event) => {
    //console.log("Sample: " + JSON.stringify(event, null, 2));

    try {
        let filename = event.queryStringParameters && event.queryStringParameters.page ? event.queryStringParameters.page : "SampleClient.html";
        const data = fs.readFileSync("./" + filename, 'utf8').replace("{{WssUrl}}", process.env.WssUrl).replace("{{sessionUrl}}", process.env.SessionUrl).replace("{{tenantUrl}}", process.env.TenantUrl);
        let contentType = filename == "SampleClient.js" ? "text/javascript" : "text/html";
        return {
            statusCode: 200,
            body: data,
            headers: { "Content-Type": contentType }
        };
    }
    catch (err) {
        console.error(err);
        return {
            statusCode: 500,
            body: JSON.stringify('Error: ' + JSON.stringify(err))
        };
    }
};
