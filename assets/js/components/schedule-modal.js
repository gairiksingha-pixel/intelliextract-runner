import { AppUtils } from "../common.js";
import { AppIcons } from "../icons.js";

/**
 * Schedule Management Modal Component
 */
let ALL_SCHEDULES = [];

export function initScheduleModal() {
  var overlay = document.getElementById("schedule-modal-overlay");
  var body = document.getElementById("schedule-modal-body");
  var closeIcon = document.getElementById("schedule-modal-close-icon");
  if (!overlay || !body) return;

  function close() {
    if (overlay.classList.contains("closing")) return;
    overlay.classList.add("closing");
    overlay.setAttribute("aria-hidden", "true");
    setTimeout(function () {
      overlay.classList.remove("open");
      overlay.classList.remove("closing");
    }, 160);
  }

  window.closeScheduleModal = close;
  window.openScheduleModal = function () {
    overlay.classList.remove("closing");
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    loadSchedulesIntoModal();
  };

  if (closeIcon) closeIcon.onclick = close;
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) close();
  });
}

function loadSchedulesIntoModal(direction) {
  fetch("/api/schedules")
    .then(function (r) {
      if (!r.ok) throw new Error("Could not load schedules");
      return r.json();
    })
    .then(function (data) {
      ALL_SCHEDULES = data.schedules || [];
      ALL_SCHEDULES.sort(function (a, b) {
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
      renderScheduleListView(
        {
          schedules: ALL_SCHEDULES,
          timezones: data.timezones || [],
        },
        direction,
      );
    })
    .catch(function () {
      renderScheduleListView({ schedules: [], timezones: ["UTC"] }, direction);
    });
}

function renderScheduleListView(state, direction) {
  AppUtils.updateModalTitle("Operation Dashboard");
  var body = document.getElementById("schedule-modal-body");
  if (!body) return;
  var schedules =
    state && Array.isArray(state.schedules) ? state.schedules : [];
  var tz = state && Array.isArray(state.timezones) ? state.timezones : [];
  var html =
    '<div class="schedule-header-row"><div class="subtitle-chip">Configure automated periodic operations</div><div style="display:flex;gap:0.51rem;flex-wrap:wrap;"><button type="button" id="schedule-history-btn" class="btn-secondary">' +
    AppIcons.HISTORY +
    '<span>History</span></button><button type="button" id="schedule-create-btn" class="download-report-btn download-report-schedule-btn">' +
    AppIcons.PLUS +
    '<span>Create Operation</span></button></div></div><div style="flex:1;display:flex;flex-direction:column;min-height:0;">';
  if (!schedules.length) {
    html +=
      '<div class="schedule-empty">No active schedules. Start by creating an operation.</div>';
  } else {
    html +=
      '<div style="flex:1;overflow-y:auto;padding-right:4px;"><table class="schedule-list"><thead><tr><th>Brand Scope</th><th>Purchaser Scope</th><th>Operation Time</th><th>Timezone</th><th>Created</th><th style="text-align:right">Actions</th></tr></thead><tbody>';
    schedules.forEach(function (s) {
      var brands =
        s.brands && s.brands.length
          ? s.brands.map(AppUtils.formatBrandName).join(", ")
          : "All Brands";
      var purchasers =
        s.purchasers && s.purchasers.length
          ? s.purchasers.map(AppUtils.formatPurchaserName).join(", ")
          : "All Purchasers";
      html +=
        "<tr data-sched-id='" +
        AppUtils.esc(s.id || "") +
        "'><td><strong>" +
        AppUtils.esc(brands) +
        "</strong></td><td>" +
        AppUtils.esc(purchasers) +
        "</td><td><span class='cron-tag'>" +
        AppUtils.esc(formatCronWithTime(s.cron)) +
        "</span></td><td>" +
        AppUtils.esc(s.timezone) +
        "</td><td>" +
        AppUtils.esc(AppUtils.formatDateWithSuffix(s.createdAt || "")) +
        '</td><td style="text-align:right"><div style="display:flex;justify-content:flex-end;gap:0.4rem;">' +
        '<button type="button" class="btn-secondary" data-sched-edit style="padding:0.4rem 0.6rem">' +
        AppIcons.EDIT +
        "</button>" +
        '<button type="button" class="btn-secondary" data-sched-delete style="padding:0.4rem 0.6rem;color:var(--fail)">' +
        AppIcons.DELETE +
        "</button>" +
        "</div></td></tr>";
    });
    html += "</tbody></table></div>";
  }
  html += "</div>";
  html +=
    '<div class="modal-footer"><button type="button" class="btn-secondary" onclick="window.closeScheduleModal()">Close window</button></div>';
  AppUtils.renderWithTransition(body, html, direction);

  var createBtn = document.getElementById("schedule-create-btn");
  if (createBtn) {
    createBtn.onclick = function () {
      renderScheduleCreateForm(tz, null, "right");
    };
  }
  var historyBtn = document.getElementById("schedule-history-btn");
  if (historyBtn) {
    historyBtn.onclick = function () {
      renderScheduleRunHistoryView("right");
    };
  }

  body.querySelectorAll("[data-sched-edit]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var tr = btn.closest("tr");
      var id = tr && tr.getAttribute("data-sched-id");
      if (!id) return;
      var sched = schedules.find(function (s) {
        return s.id === id;
      });
      if (!sched) return;
      renderScheduleCreateForm(tz, sched, "right");
    });
  });
  body.querySelectorAll("[data-sched-delete]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var tr = btn.closest("tr");
      var id = tr && tr.getAttribute("data-sched-id");
      if (!id) return;
      AppUtils.showAlert(
        "Delete Schedule",
        "Are you sure you want to delete this schedule? This action cannot be undone.",
        {
          isConfirm: true,
          onConfirm: function () {
            deleteSchedule(id);
          },
        },
      );
    });
  });
}

function getSelectedScheduleBrands() {
  var panel = document.getElementById("sched-brand-dropdown-panel");
  if (!panel) return [];
  return Array.from(
    panel.querySelectorAll("input[type=checkbox]:checked:not([value='ALL'])"),
  ).map(function (cb) {
    return cb.value;
  });
}

function getSelectedSchedulePurchasers() {
  var panel = document.getElementById("sched-purchaser-dropdown-panel");
  if (!panel) return [];
  return Array.from(
    panel.querySelectorAll("input[type=checkbox]:checked:not([value='ALL'])"),
  ).map(function (cb) {
    return cb.value;
  });
}

function updateScheduleDropdownTrigger(type) {
  var trigger = document.getElementById(
    type === "brand"
      ? "sched-brand-dropdown-trigger"
      : "sched-purchaser-dropdown-trigger",
  );
  var panel = document.getElementById(
    type === "brand"
      ? "sched-brand-dropdown-panel"
      : "sched-purchaser-dropdown-panel",
  );
  var total = panel
    ? panel.querySelectorAll("input[type=checkbox]:not([value='ALL'])").length
    : 0;

  if (panel) {
    var allCb = panel.querySelector('input[value="ALL"]');
    if (allCb) {
      var otherCbs = Array.from(
        panel.querySelectorAll('input[type=checkbox]:not([value="ALL"])'),
      );
      allCb.checked =
        otherCbs.length > 0 &&
        otherCbs.every(function (c) {
          return c.checked;
        });
    }
  }

  if (!trigger) return;
  var selected =
    type === "brand"
      ? getSelectedScheduleBrands()
      : getSelectedSchedulePurchasers();
  if (selected.length === 0) {
    trigger.textContent =
      type === "brand" ? "Select brand" : "Select purchaser";
  } else if (selected.length === 1) {
    trigger.textContent =
      type === "brand"
        ? AppUtils.formatBrandName(selected[0])
        : AppUtils.formatPurchaserName(selected[0]);
  } else {
    if (total > 0 && selected.length === total) {
      trigger.textContent = "All";
    } else {
      trigger.textContent = selected.length + " selected";
    }
  }
}

function refreshSchedulePurchaserOptions() {
  var panel = document.getElementById("sched-purchaser-dropdown-panel");
  var trigger = document.getElementById("sched-purchaser-dropdown-trigger");
  if (!panel || !trigger) return;
  var brands = getSelectedScheduleBrands();
  var opts =
    brands.length === 0
      ? window.ALL_PURCHASERS
      : (function () {
          var set = new Set();
          brands.forEach(function (b) {
            (window.BRAND_PURCHASERS[b] || []).forEach(function (p) {
              set.add(p);
            });
          });
          return Array.from(set).sort(function (a, b) {
            var nameA = AppUtils.formatPurchaserName(a).toLowerCase();
            var nameB = AppUtils.formatPurchaserName(b).toLowerCase();
            var isTempA = nameA.includes("temp");
            var isTempB = nameB.includes("temp");
            if (isTempA && !isTempB) return 1;
            if (!isTempA && isTempB) return -1;
            return nameA.localeCompare(nameB);
          });
        })();
  var currentChecked = getSelectedSchedulePurchasers();
  var allChecked =
    opts.length > 0 &&
    opts.every(function (p) {
      return currentChecked.indexOf(p) !== -1;
    });
  var allHtml =
    '<label class="filter-dropdown-option"><input type="checkbox" value="ALL"' +
    (allChecked ? " checked" : "") +
    "> <strong>All</strong></label>";
  panel.innerHTML =
    allHtml +
    opts
      .map(function (p) {
        var checked = currentChecked.indexOf(p) !== -1 ? " checked" : "";
        return (
          '<label class="filter-dropdown-option"><input type="checkbox" value="' +
          AppUtils.esc(p) +
          '"' +
          checked +
          "> " +
          AppUtils.esc(AppUtils.formatPurchaserName(p)) +
          "</label>"
        );
      })
      .join("");
  AppUtils.attachSelectAll("sched-purchaser-dropdown-panel", function () {
    updateScheduleDropdownTrigger("purchaser");
  });
  updateScheduleDropdownTrigger("purchaser");
}

function renderScheduleCreateForm(timezones, schedule, direction) {
  AppUtils.updateModalTitle(
    "Dashboard / " + (schedule ? "Edit Operation" : "New Operation"),
  );
  var body = document.getElementById("schedule-modal-body");
  if (!body) return;
  var brands = Object.keys(window.BRAND_PURCHASERS || {}).sort(function (a, b) {
    var la = AppUtils.formatBrandName(a).toLowerCase();
    var lb = AppUtils.formatBrandName(b).toLowerCase();
    return la < lb ? -1 : la > lb ? 1 : 0;
  });
  var tz = Array.isArray(timezones) && timezones.length ? timezones : ["UTC"];
  var brandOptions =
    '<label class="filter-dropdown-option"><input type="checkbox" value="ALL"> <strong>All</strong></label>' +
    brands
      .map(function (b) {
        return (
          '<label class="filter-dropdown-option"><input type="checkbox" value="' +
          AppUtils.esc(b) +
          '"> ' +
          AppUtils.esc(AppUtils.formatBrandName(b)) +
          "</label>"
        );
      })
      .join("");

  var cronOptions = "";
  for (var h = 0; h < 24; h++) {
    for (var m = 0; m < 60; m += 5) {
      var displayHour = ((h + 11) % 12) + 1; // 0 -> 12, 13 -> 1
      var ampm = h < 12 ? "AM" : "PM";
      var minLabel = String(m).padStart(2, "0");
      var label = displayHour + ":" + minLabel + " " + ampm;
      var cronVal = String(m) + " " + String(h) + " * * *";
      cronOptions +=
        '<div class="filter-dropdown-option single-select" data-value="' +
        cronVal +
        '">' +
        AppUtils.esc(label) +
        "</div>";
    }
  }
  var tzOptions = tz
    .map(function (z) {
      return (
        '<div class="filter-dropdown-option single-select" data-value="' +
        AppUtils.esc(z) +
        '">' +
        AppUtils.esc(z) +
        "</div>"
      );
    })
    .join("");

  AppUtils.renderWithTransition(
    body,
    '<div class="schedule-header-row"><div style="display:flex;align-items:center;gap:0.75rem;"><button type="button" id="schedule-form-back-btn" class="btn-secondary" style="padding: 0.4rem 0.8rem">' +
      AppIcons.BACK +
      '<span>BACK</span></button><div class="subtitle-chip">' +
      (schedule
        ? "Edit operation parameters"
        : "Launch a new operation schedule") +
      "</div></div></div>" +
      '<div style="flex:1;display:flex;flex-direction:column;min-height:0;overflow:visible;padding-right:4px;">' +
      '<div class="schedule-form-grid">' +
      '<div class="schedule-field"><label class="schedule-label" for="sched-brand-dropdown-trigger">Brand (optional)</label><div id="sched-brand-dropdown" class="filter-dropdown"><button type="button" id="sched-brand-dropdown-trigger" class="filter-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false" title="Select one or more brands">Select brand</button><div id="sched-brand-dropdown-panel" class="filter-dropdown-panel" role="listbox">' +
      brandOptions +
      '</div></div><div class="schedule-hint">Leave empty to include all brands.</div></div>' +
      '<div class="schedule-field"><label class="schedule-label" for="sched-purchaser-dropdown-trigger">Purchaser (optional)</label><div id="sched-purchaser-dropdown" class="filter-dropdown"><button type="button" id="sched-purchaser-dropdown-trigger" class="filter-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false" title="Select one or more purchasers">Select purchaser</button><div id="sched-purchaser-dropdown-panel" class="filter-dropdown-panel" role="listbox"></div></div><div class="schedule-hint">Leave empty to include all purchasers. Options update based on selected brands.</div></div>' +
      '<div class="schedule-field"><label class="schedule-label" for="sched-cron-trigger">Run time (daily)</label><div id="sched-cron-dropdown" class="filter-dropdown"><input type="hidden" id="sched-cron"><button type="button" id="sched-cron-trigger" class="filter-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false">Select time</button><div id="sched-cron-panel" class="filter-dropdown-panel" role="listbox">' +
      cronOptions +
      '</div></div><div class="schedule-hint">Runs once per day at the selected time.</div></div>' +
      '<div class="schedule-field"><label class="schedule-label" for="sched-tz-trigger">Timezone</label><div id="sched-tz-dropdown" class="filter-dropdown"><input type="hidden" id="sched-tz"><button type="button" id="sched-tz-trigger" class="filter-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false">Select timezone</button><div id="sched-tz-panel" class="filter-dropdown-panel" role="listbox">' +
      tzOptions +
      '</div></div><div class="schedule-hint">All runs use this timezone for the schedule.</div></div>' +
      "</div>" +
      '<div id="schedule-error" class="schedule-error"></div>' +
      "</div>" +
      '<div class="schedule-note-card">' +
      "<strong>⚠ Important Information:</strong> Ensure no other extraction operations are scheduled or active at this time. Manual processes or <strong>paused (Resume)</strong> states will cause this operation to be skipped to prevent data conflicts." +
      "</div>" +
      '<div class="modal-footer" style="border-top: none; padding-top: 0.5rem;"><button type="button" id="schedule-cancel-btn" class="btn-secondary">Discard</button><button type="button" id="schedule-save-btn" class="download-report-btn download-report-schedule-btn">' +
      "<span>" +
      (schedule ? "Update Changes" : "Launch Operation") +
      "</span>" +
      "</button></div>",
    direction || "right",
  );

  function updateDisabledCronOptions() {
    var cronPanel = document.getElementById("sched-cron-panel");
    var tzInput = document.getElementById("sched-tz");
    if (!cronPanel || !tzInput) return;
    var selectedTz = tzInput.value;
    var options = cronPanel.querySelectorAll(".filter-dropdown-option");
    options.forEach(function (opt) {
      var cronVal = opt.getAttribute("data-value");
      var inUse = ALL_SCHEDULES.some(function (s) {
        return (
          s.cron === cronVal &&
          s.timezone === selectedTz &&
          (!schedule || s.id !== schedule.id)
        );
      });
      if (inUse) {
        opt.classList.add("disabled");
        if (opt.textContent.indexOf(" (In Use)") === -1) {
          opt.textContent += " (In Use)";
        }
      } else {
        opt.classList.remove("disabled");
        opt.textContent = opt.textContent.replace(" (In Use)", "");
      }
    });
  }

  var tzEl = document.getElementById("sched-tz");
  if (tzEl) {
    tzEl.addEventListener("change", updateDisabledCronOptions);
  }
  updateDisabledCronOptions();

  refreshSchedulePurchaserOptions();
  var brandTrigger = document.getElementById("sched-brand-dropdown-trigger");
  var brandPanel = document.getElementById("sched-brand-dropdown-panel");
  var cronTrigger = document.getElementById("sched-cron-trigger");
  var cronPanel = document.getElementById("sched-cron-panel");
  var tzTrigger = document.getElementById("sched-tz-trigger");
  var tzPanel = document.getElementById("sched-tz-panel");
  var purchaserTrigger = document.getElementById(
    "sched-purchaser-dropdown-trigger",
  );
  var purchaserPanel = document.getElementById(
    "sched-purchaser-dropdown-panel",
  );

  function closeScheduleDropdowns() {
    if (brandPanel) brandPanel.classList.remove("open");
    if (purchaserPanel) purchaserPanel.classList.remove("open");
    if (cronPanel) cronPanel.classList.remove("open");
    if (tzPanel) tzPanel.classList.remove("open");
  }

  function toggleScheduleDropdown(panel, trigger) {
    var isOpen = panel && panel.classList.contains("open");
    closeScheduleDropdowns();
    if (!isOpen && panel && trigger) {
      panel.classList.add("open");
      trigger.setAttribute("aria-expanded", "true");
    }
  }

  if (brandTrigger && brandPanel) {
    brandTrigger.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleScheduleDropdown(brandPanel, brandTrigger);
    });
  }
  if (cronTrigger && cronPanel) {
    cronTrigger.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleScheduleDropdown(cronPanel, cronTrigger);
    });
  }
  if (tzTrigger && tzPanel) {
    tzTrigger.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleScheduleDropdown(tzPanel, tzTrigger);
    });
  }
  if (purchaserTrigger && purchaserPanel) {
    purchaserTrigger.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleScheduleDropdown(purchaserPanel, purchaserTrigger);
    });
  }

  [brandPanel, purchaserPanel, cronPanel, tzPanel].forEach((p) => {
    p?.addEventListener("click", (e) => e.stopPropagation());
  });

  // Close dropdowns when clicking anywhere else in the modal body
  body.onclick = function () {
    closeScheduleDropdowns();
  };

  function initSingleSelectDropdown(panel, trigger, inputId, onSelect) {
    if (!panel || !trigger) return;
    var input = document.getElementById(inputId);
    panel.querySelectorAll(".filter-dropdown-option").forEach(function (opt) {
      opt.onclick = function (e) {
        e.stopPropagation();
        if (opt.classList.contains("disabled")) return;
        var val = opt.getAttribute("data-value");
        if (input) input.value = val;
        trigger.textContent = opt.textContent.replace(" (In Use)", "");
        panel.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
        if (onSelect) onSelect(val);
      };
    });
  }

  initSingleSelectDropdown(cronPanel, cronTrigger, "sched-cron");
  initSingleSelectDropdown(tzPanel, tzTrigger, "sched-tz", function () {
    updateDisabledCronOptions();
  });

  AppUtils.attachSelectAll("sched-brand-dropdown-panel", function () {
    updateScheduleDropdownTrigger("brand");
    refreshSchedulePurchaserOptions();
  });

  var backBtnHeader = document.getElementById("schedule-form-back-btn");
  if (backBtnHeader) {
    backBtnHeader.onclick = function () {
      loadSchedulesIntoModal("left");
    };
  }
  var cancelBtn = document.getElementById("schedule-cancel-btn");
  if (cancelBtn) {
    cancelBtn.onclick = function () {
      loadSchedulesIntoModal("left");
    };
  }
  var saveBtn = document.getElementById("schedule-save-btn");
  if (saveBtn) {
    saveBtn.onclick = function () {
      submitScheduleForm(schedule);
    };
  }

  if (schedule) {
    var cronInput = document.getElementById("sched-cron");
    var tzInput = document.getElementById("sched-tz");
    if (schedule.brands && schedule.brands.length) {
      schedule.brands.forEach(function (b) {
        var cb = brandPanel.querySelector(
          'input[type=checkbox][value="' + AppUtils.esc(b) + '"]',
        );
        if (cb) cb.checked = true;
      });
      updateScheduleDropdownTrigger("brand");
      refreshSchedulePurchaserOptions();
    }
    if (schedule.purchasers && schedule.purchasers.length) {
      schedule.purchasers.forEach(function (p) {
        var cb = purchaserPanel.querySelector(
          'input[type=checkbox][value="' + AppUtils.esc(p) + '"]',
        );
        if (cb) cb.checked = true;
      });
      updateScheduleDropdownTrigger("purchaser");
    }
    if (cronInput && schedule.cron) {
      cronInput.value = schedule.cron;
      var cronOpt = cronPanel.querySelector(
        '.filter-dropdown-option[data-value="' + schedule.cron + '"]',
      );
      if (cronOpt && cronTrigger)
        cronTrigger.textContent = cronOpt.textContent.replace(" (In Use)", "");
    }
    if (tzInput && schedule.timezone) {
      tzInput.value = schedule.timezone;
      var tzOpt = tzPanel.querySelector(
        '.filter-dropdown-option[data-value="' + schedule.timezone + '"]',
      );
      if (tzOpt && tzTrigger) tzTrigger.textContent = tzOpt.textContent;
    }
  }
}

function deleteSchedule(id) {
  fetch("/api/schedules/" + encodeURIComponent(id), {
    method: "DELETE",
  })
    .then(function (r) {
      if (!r.ok) throw new Error("Failed to delete schedule");
      loadSchedulesIntoModal("left");
    })
    .catch(function () {});
}

function submitScheduleForm(schedule) {
  var cronEl = document.getElementById("sched-cron");
  var tzEl = document.getElementById("sched-tz");
  var errorEl = document.getElementById("schedule-error");
  if (!cronEl || !tzEl || !errorEl) return;
  var brands = getSelectedScheduleBrands();
  var purchasers = getSelectedSchedulePurchasers();
  var cron = (cronEl.value || "").trim();
  var timezone = (tzEl.value || "").trim();
  errorEl.textContent = "";

  if (brands.length === 0 && purchasers.length === 0) {
    errorEl.textContent = "Please select at least one brand or purchaser.";
    return;
  }
  if (!cron) {
    errorEl.textContent = "Run time is required.";
    return;
  }
  if (!timezone) {
    errorEl.textContent = "Timezone is required.";
    return;
  }

  var isDuplicate = ALL_SCHEDULES.some(function (s) {
    return (
      s.cron === cron &&
      s.timezone === timezone &&
      (!schedule || s.id !== schedule.id)
    );
  });
  if (isDuplicate) {
    errorEl.textContent =
      "A schedule for this time and timezone already exists.";
    return;
  }

  var url = "/api/schedules";
  var method = "POST";
  if (schedule && schedule.id) {
    url = "/api/schedules/" + encodeURIComponent(schedule.id);
    method = "PUT";
  }

  fetch(url, {
    method: method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      brands: brands,
      purchasers: purchasers,
      cron: cron,
      timezone: timezone,
    }),
  })
    .then(function (r) {
      if (!r.ok) {
        return r.json().then(function (err) {
          throw new Error(
            err && err.error ? err.error : "Failed to save schedule",
          );
        });
      }
      return r.json();
    })
    .then(function () {
      loadSchedulesIntoModal("left");
    })
    .catch(function (e) {
      errorEl.textContent =
        e && e.message ? e.message : "Failed to save schedule.";
      errorEl.style.display = "block";
    });
}

function renderScheduleRunHistoryView(direction, page) {
  page = page || 1;
  AppUtils.updateModalTitle("Dashboard / Execution Logs");
  var body = document.getElementById("schedule-modal-body");
  if (!body) return;

  if (page === 1) {
    AppUtils.renderWithTransition(
      body,
      '<div class="schedule-header-row"><div style="display:flex;align-items:center;gap:0.75rem;"><button type="button" id="schedule-log-back-btn" class="btn-secondary" style="padding: 0.4rem 0.8rem">' +
        AppIcons.BACK +
        '<span>BACK</span></button><div class="subtitle-chip">Schedule execution logs</div></div></div><div class="schedule-empty">Loading history logs...</div><div class="modal-footer" style="margin-top:0.85rem; border-top:none;"><button type="button" class="btn-secondary" onclick="window.closeScheduleModal()">Cancel</button></div>',
      direction || "right",
    );
    var backBtn = document.getElementById("schedule-log-back-btn");
    if (backBtn) {
      backBtn.onclick = function () {
        loadSchedulesIntoModal("left");
      };
    }
  }

  fetch("/api/schedule-log?page=" + page + "&limit=15")
    .then(function (r) {
      if (!r.ok) throw new Error("Could not load schedule log");
      return r.json();
    })
    .then(function (data) {
      var entries = data.entries || [];
      var html =
        '<div class="schedule-header-row"><div style="display:flex;align-items:center;gap:0.75rem;"><button type="button" id="schedule-log-back-btn" class="btn-secondary" style="padding: 0.4rem 0.8rem">' +
        AppIcons.BACK +
        '<span>BACK</span></button><div class="subtitle-chip">Schedule execution logs</div></div></div><div style="flex:1;display:flex;flex-direction:column;overflow-y:auto;padding-right:4px;">';
      if (!entries.length) {
        html +=
          '<div class="schedule-empty">No execution history found yet. Logs for operations will appear here.</div>';
      } else {
        html +=
          '<table class="schedule-list"><thead><tr><th>Time</th><th>Schedule ID</th><th>Outcome</th><th>Message</th></tr></thead><tbody>';
        entries.forEach(function (e) {
          var time = AppUtils.formatTimeIST(e.timestamp);
          var schedId =
            e.scheduleId != null ? String(e.scheduleId).slice(0, 20) : "";
          var outcome = (e.outcome || "executed").toLowerCase();
          var outcomeLabel = outcome === "skipped" ? "Skipped" : "Executed";
          var outcomeClass =
            outcome === "skipped"
              ? "schedule-outcome-skipped"
              : "schedule-outcome-executed";
          var msg = e.message || "";
          if (outcome === "executed") {
            if (e.exitCode === 0) msg = "Operation completed successfully";
            else if (e.exitCode != null)
              msg = "Operation completed with issues";
          }
          if (e.error) msg += (msg ? " : " : "") + e.error;
          html +=
            "<tr><td>" +
            AppUtils.esc(time) +
            "</td><td>" +
            AppUtils.esc(schedId) +
            '</td><td><span class="' +
            outcomeClass +
            '">' +
            AppUtils.esc(outcomeLabel) +
            "</span></td><td>" +
            AppUtils.esc(msg) +
            "</td></tr>";
        });
        html += "</tbody></table>";
        html +=
          '<div id="schedule-log-pagination" class="pagination-wrap"></div>';
      }
      html +=
        '</div><div class="modal-footer" style="margin-top:0.85rem; border-top:none;"><button type="button" class="btn-secondary" onclick="window.closeScheduleModal()">Cancel</button></div>';

      if (page === 1)
        AppUtils.renderWithTransition(body, html, direction || "right");
      else body.innerHTML = html;

      AppUtils.renderPagination(
        document.getElementById("schedule-log-pagination"),
        data.total,
        data.page,
        data.limit,
        function (p) {
          renderScheduleRunHistoryView(null, p);
        },
      );

      var backBtn = document.getElementById("schedule-log-back-btn");
      if (backBtn) {
        backBtn.onclick = function () {
          loadSchedulesIntoModal("left");
        };
      }
    })
    .catch(function () {});
}

function formatCronWithTime(cron) {
  if (!cron) return "—";
  var parts = cron.split(" ");
  if (parts.length < 2) return cron;
  var m = parts[0].padStart(2, "0");
  var h = parseInt(parts[1]);
  var ampm = h < 12 ? "AM" : "PM";
  var displayHour = ((h + 11) % 12) + 1;
  return displayHour + ":" + m + " " + ampm + " Daily";
}

// Export to global scope
window.initScheduleModal = initScheduleModal;
