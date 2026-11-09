// DualBackendManager.js
// Owns ALL network logic for the guided-maintenance Lens (BlocTi event log + stoQr
// inventory / procurement via Supabase).
//
//   USE_MOCK_API = true  (default) -> no HTTP at all: wait 500 ms to simulate
//                         latency, then return hard-coded success payloads.
//   USE_MOCK_API = false -> attempt the real calls. The Audit Log animates only
//                         after a 200 OK. On any failure the mock payload is
//                         returned with offline = true (Audit Log turns yellow).
//
// Endpoints and keys below are PLACEHOLDERS. The Lens compiles and runs in mock
// mode with no API keys. Never commit real keys to the project.
//
// API (called from B2BMaintenanceMain.ts):
//   script.logStepOneComplete(taskInfo, callback)  // BlocTi PSU_Swap + stoQr reorder
//   script.closeTicket(taskInfo, callback)         // BlocTi Task Complete
//   callback(result) where result = { lines: string[], offline: boolean, mock: boolean }
//   script.isMockMode() -> boolean

const USE_MOCK_API = true;

const MOCK_LATENCY_SECONDS = 0.5;

// Placeholder configuration (fill in for a real deployment; leave empty for the demo).
const BLOCTI_ENDPOINT = "https://example.invalid/blocti/v1/events";
const BLOCTI_API_KEY = "";
const STOQR_SUPABASE_URL = "https://example.invalid.supabase.co";
const STOQR_SUPABASE_ANON_KEY = "";
const STOQR_INVENTORY_TABLE = "inventory";
const STOQR_PROCUREMENT_TABLE = "procurement_queue";

const MOCK_STEP1 = [
    "[BlocTi API]: Event Logged. Task: PSU_Swap. Time: 45s. Fidelity: 100%.",
    "[stoQr API]: Stock Alert: PSU dropped to 'Low'. Reorder queued at £145.00."
];
const MOCK_CLOSE = [
    "[BlocTi API]: Task Complete. Total Duration: 2m 14s. Fidelity: 100%. Ticket Closed."
];

function log(msg) {
    print("[DualBackendManager] " + msg);
}

function later(seconds, fn) {
    const ev = script.createEvent("DelayedCallbackEvent");
    ev.bind(function () { fn(); });
    ev.reset(seconds);
}

function mockResult(lines, offline) {
    return { lines: lines.slice(), offline: !!offline, mock: true };
}

function getInternetModule() {
    if (script.internetModule) {
        return script.internetModule;
    }
    try {
        return require("LensStudio:InternetModule");
    } catch (e) {
        return null;
    }
}

// Sends one JSON request. onDone(ok: boolean, body: string)
function postJson(url, headers, payload, onDone) {
    const internet = getInternetModule();
    if (!internet || !url || url.indexOf("example.invalid") >= 0) {
        log("Real endpoint not configured: " + url);
        onDone(false, "");
        return;
    }
    try {
        const h = { "Content-Type": "application/json" };
        for (const k in headers) {
            if (headers[k]) {
                h[k] = headers[k];
            }
        }
        internet.fetch(url, { method: "POST", headers: h, body: JSON.stringify(payload) })
            .then(function (response) {
                return response.text().then(function (text) {
                    onDone(response.status === 200 || response.status === 201, text);
                });
            })
            .catch(function (err) {
                log("Request failed: " + err);
                onDone(false, "");
            });
    } catch (e) {
        log("Request threw: " + e);
        onDone(false, "");
    }
}

function blocTiLog(event, onDone) {
    postJson(BLOCTI_ENDPOINT, { "x-api-key": BLOCTI_API_KEY }, event, onDone);
}

// stoQr: deduct one PSU, set state 'Low', push to the automated procurement list.
function stoQrReorder(partId, onDone) {
    const headers = {
        "apikey": STOQR_SUPABASE_ANON_KEY,
        "Authorization": STOQR_SUPABASE_ANON_KEY ? "Bearer " + STOQR_SUPABASE_ANON_KEY : ""
    };
    postJson(STOQR_SUPABASE_URL + "/rest/v1/rpc/deduct_and_reorder", headers, {
        part_id: partId,
        quantity: 1,
        new_state: "Low",
        inventory_table: STOQR_INVENTORY_TABLE,
        procurement_table: STOQR_PROCUREMENT_TABLE
    }, onDone);
}

script.isMockMode = function () {
    return USE_MOCK_API;
};

script.logStepOneComplete = function (taskInfo, callback) {
    const info = taskInfo || {};
    if (USE_MOCK_API) {
        log("MOCK: logging PSU_Swap + stoQr reorder (500 ms simulated latency)");
        later(MOCK_LATENCY_SECONDS, function () { callback(mockResult(MOCK_STEP1, false)); });
        return;
    }
    const event = {
        task_id: info.taskId || "PSU_Swap",
        ticket_id: info.ticketId || "",
        timestamp: new Date().toISOString(),
        time_to_complete_s: info.elapsedSeconds || 0
    };
    blocTiLog(event, function (okBlocTi) {
        stoQrReorder(info.partId || "PSU", function (okStoQr) {
            if (okBlocTi && okStoQr) {
                callback({ lines: MOCK_STEP1.slice(), offline: false, mock: false });
            } else {
                log("Real API failed -> offline sync, showing mock payload in yellow");
                callback(mockResult(MOCK_STEP1, true));
            }
        });
    });
};

script.closeTicket = function (taskInfo, callback) {
    const info = taskInfo || {};
    if (USE_MOCK_API) {
        log("MOCK: closing ticket (500 ms simulated latency)");
        later(MOCK_LATENCY_SECONDS, function () { callback(mockResult(MOCK_CLOSE, false)); });
        return;
    }
    const event = {
        task_id: "Ticket_Close",
        ticket_id: info.ticketId || "",
        timestamp: new Date().toISOString(),
        total_duration_s: info.elapsedSeconds || 0
    };
    blocTiLog(event, function (ok) {
        if (ok) {
            callback({ lines: MOCK_CLOSE.slice(), offline: false, mock: false });
        } else {
            log("Real API failed -> offline sync, showing mock payload in yellow");
            callback(mockResult(MOCK_CLOSE, true));
        }
    });
};

log("Ready. USE_MOCK_API = " + USE_MOCK_API);
