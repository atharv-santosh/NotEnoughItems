// Popup script for NotEnoughItems

function withActiveTab(cb) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs.length) return;
        cb(tabs[0]);
    });
}

function setStatus(text) {
    document.getElementById('status').textContent = `Status: ${text}`;
}

function setItemCount(n) {
    const el = document.getElementById('itemCount');
    if (el) el.textContent = `Items: ${n}`;
}

function refreshStatus() {
    withActiveTab(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }, (res) => {
            if (chrome.runtime.lastError || !res) {
                setStatus('Not available on this page');
                setItemCount('?');
                return;
            }
            setStatus(`running=${res.running} | triedPairs=${res.triedPairs}`);
            setItemCount(res.items ?? '?');
            updateToggle(res.running);
            refreshRestricted();
        });
    });
}

function updateToggle(isRunning) {
    const btn = document.getElementById('toggleBot');
    if (!btn) return;
    if (isRunning) {
        btn.textContent = 'Stop';
        btn.classList.remove('primary');
        btn.classList.add('danger');
    } else {
        btn.textContent = 'Start';
        btn.classList.remove('danger');
        btn.classList.add('primary');
    }
}

function setRestrictedList(list) {
    const el = document.getElementById('restrictedList');
    if (!el) return;
    if (!list || !list.length) { el.textContent = 'Restricted: (none)'; return; }
    el.textContent = `Restricted: ${list.join(', ')}`;
}

function refreshRestricted() {
    withActiveTab(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'getRestricted' }, (res) => {
            if (res && res.restricted) setRestrictedList(res.restricted);
        });
    });
}

document.getElementById('toggleBot').addEventListener('click', () => {
    withActiveTab(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'getStatus' }, (res) => {
            const running = !!(res && res.running);
            const action = running ? 'stopBot' : 'startBot';
            chrome.tabs.sendMessage(tab.id, { action }, () => {
                refreshStatus();
            });
        });
    });
});

document.getElementById('fetchElements').addEventListener('click', () => {
    withActiveTab(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'getElements' }, (response) => {
            const elDiv = document.getElementById('elements');
            if (chrome.runtime.lastError) {
                elDiv.textContent = 'Cannot access this tab. Open Infinite Craft first.';
                return;
            }
            if (response && response.elements && response.elements.length) {
                elDiv.innerHTML = '<b>Items (data-item-text):</b><br>' + response.elements.map(e => `<div>${e}</div>`).join('');
                setItemCount(response.elements.length);
            } else {
                elDiv.textContent = 'No elements found.';
                setItemCount('0');
            }
            refreshStatus();
        });
    });
});

// Calibration buttons

document.getElementById('calibPickup').addEventListener('click', () => {
    withActiveTab(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'calibratePickupPoint' }, (res) => {
            if (!res || !res.ok) { setStatus('Pickup calibration canceled/failed'); return; }
            setStatus(`Pickup calibrated (${(res.pickupOffset.xPct*100|0)}%, ${(res.pickupOffset.yPct*100|0)}%)`);
        });
    });
});

document.getElementById('calibDrop').addEventListener('click', () => {
    withActiveTab(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'calibrateDropPoint' }, (res) => {
            if (!res || !res.ok) { setStatus('Drop calibration canceled/failed'); return; }
            setStatus(`Drop calibrated (${(res.dropOffset.xPct*100|0)}%, ${(res.dropOffset.yPct*100|0)}%)`);
        });
    });
});

// Restricted controls

document.getElementById('addRestricted').addEventListener('click', () => {
    const name = document.getElementById('restrictedInput').value.trim();
    if (!name) return;
    withActiveTab(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'addRestricted', name }, (res) => {
            if (res && res.ok) {
                setRestrictedList(res.restricted);
                document.getElementById('restrictedInput').value = '';
            }
        });
    });
});

document.getElementById('removeRestricted').addEventListener('click', () => {
    const name = document.getElementById('restrictedInput').value.trim();
    if (!name) return;
    withActiveTab(tab => {
        chrome.tabs.sendMessage(tab.id, { action: 'removeRestricted', name }, (res) => {
            if (res && res.ok) {
                setRestrictedList(res.restricted);
                document.getElementById('restrictedInput').value = '';
            }
        });
    });
});

// Auto-refresh status when popup opens
refreshStatus();
refreshRestricted();
