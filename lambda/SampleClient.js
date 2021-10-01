// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const connectButton = document.querySelector("#connect");
const createSessionButton = document.querySelector("#createSession");
const deleteSessionButton = document.querySelector("#deleteSession");
const clearLogButton = document.querySelector("#clearLog");
const sendButton = document.querySelector("#send");
const sendQueueButton = document.querySelector("#sendQueue");
const tenantId = document.querySelector("#tenantId");
const sessionId = document.querySelector("#sessionId");
const message = document.querySelector("#message");
const chatLog = document.querySelector("#chatLog");
const sessionUrl = "{{sessionUrl}}";
const tenantUrl = "{{tenantUrl}}";
const websocketUrl = "{{WssUrl}}";
let messageDeduplicationId = 0;
let connection;

function addCommunication(input, event) {
    console.log(input, event);
    let li = document.createElement('li');
    li.innerText = new Date().toLocaleTimeString() + ": " + input;
    chatLog.prepend(li);
}

function createUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0,
            v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
clearLogButton.addEventListener("click", () => {
    chatLog.innerHTML = "";
});

window.onload = function() {
    sessionId.value = getCookie("sessionuuid");
    loadTenants();
};

function getCookie(cname) {
    let name = cname + "=";
    let decodedCookie = decodeURIComponent(document.cookie);
    let ca = decodedCookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) == ' ') {
            c = c.substring(1);
        }
        if (c.indexOf(name) == 0) {
            return c.substring(name.length, c.length);
        }
    }
    return "";
}

function setCookie(cname, cvalue, exdays) {
    const d = new Date();
    d.setTime(d.getTime() + (exdays * 24 * 60 * 60 * 1000));
    let expires = "expires=" + d.toUTCString();
    document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
}

function loadTenants() {
    tenantId.innerHTML = "";
    var xhr = new XMLHttpRequest();
    addCommunication("Loading tenants", undefined);
    xhr.onerror = function() {
        addCommunication("Loading tenants error " + xhr.status + ": " + xhr.statusText, xhr);
    };
    xhr.onabort = function() {
        addCommunication("Load tenants aborted", xhr);
    };
    xhr.onload = function(e) {
        if (xhr.status != 200) { // analyze HTTP status of the response
            addCommunication("Loading tenants error " + xhr.status + ": " + xhr.statusText, xhr);
        }
        else { // show the result
            addCommunication("Tenants loaded", xhr);
            let items = JSON.parse(xhr.response);
            for (let x = 0; x < items.Items.length; x++) {
                console.log("Item: " + JSON.stringify(items.Items[x]));
                var opt = document.createElement('option');
                opt.value = items.Items[x].tenantId;
                opt.innerHTML = items.Items[x].tenantId;
                tenantId.appendChild(opt);
            }
        }
    };

    xhr.open("GET", tenantUrl);
    xhr.send();
}

createSessionButton.addEventListener("click", () => {
    var xhr = new XMLHttpRequest();
    let uuid = createUUID();
    addCommunication("Creating session " + uuid, undefined);
    xhr.onerror = function() {
        addCommunication("Session create error " + xhr.status + ": " + xhr.statusText, xhr);
    };
    xhr.onabort = function() {
        addCommunication("Session create aborted " + uuid, xhr);
    };
    xhr.onload = function(e) {
        if (xhr.status != 200) { // analyze HTTP status of the response
            addCommunication("Session create error " + xhr.status + ": " + xhr.statusText, xhr);
        }
        else { // show the result
            addCommunication("Created session " + uuid, xhr);
            setCookie("sessionuuid", uuid, 1);
        }
    };

    xhr.open("PUT", sessionUrl + "?tenantId=" + tenantId.value + "&sessionId=" + uuid);
    sessionId.value = uuid;
    xhr.send();
});

deleteSessionButton.addEventListener("click", () => {
    var xhr = new XMLHttpRequest();
    let uuid = sessionId.value;
    addCommunication("Deleting session " + uuid, undefined);
    xhr.onerror = function() {
        addCommunication("Session delete error " + xhr.status + ": " + xhr.statusText, xhr);
    };
    xhr.onabort = function() {
        addCommunication("Session delete aborted " + uuid, xhr);
    };
    xhr.onload = function(e) {
        if (xhr.status != 200) { // analyze HTTP status of the response
            addCommunication("Session delete error " + xhr.status + ": " + xhr.statusText, xhr);
        }
        else { // show the result
            addCommunication("Deleted session " + uuid, xhr);
            setCookie("sessionuuid", "", 1);
            sessionId.value = "";
        }
    };

    xhr.open("DELETE", sessionUrl + "?tenantId=" + tenantId.value + "&sessionId=" + uuid);
    xhr.send();
});

connectButton.addEventListener("click", () => {
    if (connection) {
        addCommunication("Disconnecting", undefined);
        connection.close();
    }
    else {
        addCommunication("Connecting", undefined);
        connection = new WebSocket(websocketUrl + "?tenantId=" + tenantId.value + "&sessionId=" + sessionId.value);
        connectButton.innerHTML = "Disconnect";
        connection.onopen = (event) => {
            addCommunication("Connected", event);
        };

        connection.onclose = (event) => {
            addCommunication("Disconnected", event);
            connectButton.innerHTML = "Connect";
            connection = undefined;
        };

        connection.onerror = (event) => {
            addCommunication("Connection error. See console for details.", event);
        };

        connection.onmessage = (event) => {
            let starter = event.data.startsWith("Echo") ? "Recv: " : "Sent: ";
            addCommunication(starter + event.data, event);
        };
    }
});

sendButton.addEventListener("click", () => {
    let data = {};
    data.message = message.value;
    let sendData = JSON.stringify(data);
    connection.send(sendData);
    addCommunication("Sent: " + sendData);
});

sendQueueButton.addEventListener("click", () => {
    let data = {};
    data.message = message.value;
    let dupId = getCookie("tenant:" + tenantId.value + ":session:" + sessionId.value + ":messageDeduplicationId");
    if (dupId) {
        messageDeduplicationId = parseInt(dupId, 10);
    } else {
        messageDeduplicationId = 0;
    }
    data.messageDeduplicationId = messageDeduplicationId;
    messageDeduplicationId = messageDeduplicationId + 1;
    setCookie("tenant:" + tenantId.value + ":session:" + sessionId.value + ":messageDeduplicationId", messageDeduplicationId, 1);
    data.action = "PerTenantSQS";
    let sendData = JSON.stringify(data);
    connection.send(sendData);
    addCommunication("Sent: " + sendData);
});
