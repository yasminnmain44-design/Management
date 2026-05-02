// ======================== THEME SYSTEM ========================
function initTheme() {
    const savedTheme = localStorage.getItem('appTheme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('appTheme', next);
}

// ======================== FIREBASE CONFIG ========================
const firebaseConfig = {
    apiKey: "AIzaSyDjImFc52SF5TlN7k7vz0H6-8bWl8Pkz0k",
    authDomain: "haat-a88ee.firebaseapp.com",
    databaseURL: "https://haat-a88ee-default-rtdb.firebaseio.com",
    projectId: "haat-a88ee",
    storageBucket: "haat-a88ee.appspot.com",
    messagingSenderId: "123456789012",
    appId: "1:123456789012:web:abcdef1234567890"
};

firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// ======================== APP STATE ========================
let employees = [], attendance = [], leaves = [], financials = [];
let employeeDatabase = [], cashTransactions = [], stations = [], supervisors = [];
let faults = [], loans = [];
let currentReportData = null;
let isConnected = false;
let connectionRetryCount = 0;
const maxRetries = 3;
let currentLoanFilter = 'pending';
let quickSearchTimeout = null;
let searchableInstances = [];

const arabicWords = [
    'قمة','بحر','نور','سحر','أمل','نجاح','تميز','ابداع','تفوق','ريادة',
    'سماء','قمر','شمس','ورد','عطر','لؤلؤ','مرجان','ياقوت','زمرد','فيروز',
    'صقر','نسر','أسد','نمر','فهد','غزال','يمامة','بلبل','عندليب','بومة'
];

// ======================== DOM REFERENCES ========================
const sideMenu = document.getElementById('sideMenu');
const overlay = document.getElementById('overlay');
const menuBtn = document.getElementById('menuBtn');
const closeMenuBtn = document.getElementById('closeMenu');
const exportBtn = document.getElementById('exportBtn');
const connectionStatus = document.getElementById('connectionStatus');

// ======================== SEARCHABLE SELECT ========================
function enhanceSelectToSearchable(selectId, containerId, placeholder = "ابحث عن موظف...") {
    const originalSelect = document.getElementById(selectId);
    if (!originalSelect) return null;
    const container = document.getElementById(containerId);
    if (!container) return null;
    originalSelect.style.display = 'none';
    const wrapper = document.createElement('div');
    wrapper.className = 'searchable-select-container';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'searchable-select-input';
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    const dropdown = document.createElement('div');
    dropdown.className = 'searchable-select-dropdown';
    wrapper.appendChild(input);
    wrapper.appendChild(dropdown);
    container.innerHTML = '';
    container.appendChild(wrapper);

    function updateDropdownOptions(filterText = '') {
        const options = Array.from(originalSelect.options);
        dropdown.innerHTML = '';
        let filtered = options.filter(o => o.value !== '');
        if (filterText.trim() !== '') {
            const term = filterText.trim().toLowerCase();
            filtered = filtered.filter(o => o.textContent.toLowerCase().includes(term));
        }
        if (filtered.length === 0) {
            const no = document.createElement('div');
            no.className = 'searchable-select-no-results';
            no.textContent = 'لا توجد نتائج';
            dropdown.appendChild(no);
        } else {
            filtered.forEach(opt => {
                const div = document.createElement('div');
                div.className = 'searchable-select-option';
                div.textContent = opt.textContent;
                div.setAttribute('data-value', opt.value);
                div.addEventListener('click', () => {
                    input.value = opt.textContent;
                    originalSelect.value = opt.value;
                    originalSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    dropdown.classList.remove('show');
                });
                dropdown.appendChild(div);
            });
        }
    }

    const sel = originalSelect.options[originalSelect.selectedIndex];
    if (sel && sel.value) input.value = sel.textContent;

    input.addEventListener('input', function() { updateDropdownOptions(this.value); dropdown.classList.add('show'); });
    input.addEventListener('focus', function() { updateDropdownOptions(this.value); dropdown.classList.add('show'); });
    document.addEventListener('click', function(e) { if (!wrapper.contains(e.target)) dropdown.classList.remove('show'); });
    originalSelect.addEventListener('change', function() {
        const s = originalSelect.options[originalSelect.selectedIndex];
        if (s && s.value) input.value = s.textContent; else input.value = '';
    });
    const observer = new MutationObserver(() => {
        const s = originalSelect.options[originalSelect.selectedIndex];
        if (s && s.value) input.value = s.textContent;
        updateDropdownOptions(input.value);
    });
    observer.observe(originalSelect, { childList: true, subtree: true });
    return { wrapper, input, dropdown, observer };
}

const searchableSelectsConfig = [
    { selectId: 'attendanceEmployee', containerId: 'attendanceEmployeeContainer', placeholder: 'ابحث عن موظف...' },
    { selectId: 'financialEmployee', containerId: 'financialEmployeeContainer', placeholder: 'ابحث عن موظف...' },
    { selectId: 'selectEmployeeForReport', containerId: 'selectEmployeeForReportContainer', placeholder: 'ابحث عن موظف...' },
    { selectId: 'filterFinancialEmployee', containerId: 'filterFinancialEmployeeContainer', placeholder: 'ابحث عن موظف...' },
    { selectId: 'reportEmployeeFilter', containerId: 'reportEmployeeFilterContainer', placeholder: 'ابحث عن موظف...' },
    { selectId: 'supervisorEmployee', containerId: 'supervisorEmployeeContainer', placeholder: 'ابحث عن موظف...' }
];

function initSearchableSelects() {
    searchableInstances.forEach(inst => { if (inst.observer) inst.observer.disconnect(); });
    searchableInstances = [];
    searchableSelectsConfig.forEach(item => {
        const inst = enhanceSelectToSearchable(item.selectId, item.containerId, item.placeholder);
        if (inst) searchableInstances.push(inst);
    });
}

// ======================== FIREBASE OPERATIONS ========================
function monitorConnection() {
    const connectedRef = firebase.database().ref(".info/connected");
    connectedRef.on("value", function(snap) {
        if (snap.val() === true) {
            isConnected = true; connectionRetryCount = 0;
            connectionStatus.textContent = "✓ متصل بقاعدة البيانات السحابية";
            connectionStatus.className = "connection-status connection-online";
            connectionStatus.style.display = "block";
        } else {
            isConnected = false;
            connectionStatus.textContent = "✗ غير متصل بقاعدة البيانات السحابية";
            connectionStatus.className = "connection-status connection-offline";
            connectionStatus.style.display = "block";
            if (connectionRetryCount < maxRetries) { connectionRetryCount++; setTimeout(() => { if (!isConnected) monitorConnection(); }, 5000); }
        }
    });
}

function loadAllData() {
    showLoadingState(true);
    Promise.all([
        loadData('employees'), loadData('attendance'), loadData('leaves'), loadData('financials'),
        loadData('employeeDatabase'), loadData('cashTransactions'), loadData('stations'),
        loadData('supervisors'), loadData('faults'), loadData('loans')
    ]).then(() => {
        showLoadingState(false);
        updateEmployeesDropdowns(); updateDatabaseEmployeesDropdown(); updateStationDropdowns();
        updateSupervisorDropdowns(); updateCashSupervisorDropdowns(); updateLoanFilterDropdowns();
        updateReportFilterDropdowns(); updateDashboard(); updateCashStats();
        displayEmployeesList(); displayEmployeeDatabase(); displayAttendanceList();
        displayFinancialsList(); displayCashTransactions(); updateCashSummary();
        displayStationsList(); displaySupervisorsList(); displayFaultsList();
        displayRecentCashTransactions(); displayLoansList(); updateStationsBar();
        initSearchableSelects();
        connectionStatus.textContent = "✓ تم تحميل البيانات بنجاح من السحابة";
        connectionStatus.className = "connection-status connection-online";
        connectionStatus.style.display = "block";
        setTimeout(() => { connectionStatus.style.display = "none"; }, 3000);
    }).catch(error => {
        console.error('خطأ في تحميل البيانات من Firebase:', error);
        showLoadingState(false);
        connectionStatus.textContent = "✗ فشل الاتصال بقاعدة البيانات السحابية";
        connectionStatus.className = "connection-status connection-offline";
        connectionStatus.style.display = "block";
        showErrorMessage('فشل الاتصال بقاعدة البيانات السحابية. يرجى التحقق من اتصال الإنترنت والمحاولة مرة أخرى.');
    });
}

function loadData(dataType) {
    return new Promise((resolve, reject) => {
        database.ref(dataType).once('value').then((snapshot) => {
            const data = snapshot.val();
            const dataArray = data ? Object.keys(data).map(key => ({ id: key, ...data[key] })) : [];
            const map = { employees, attendance, leaves, financials, employeeDatabase, cashTransactions, stations, supervisors, faults, loans };
            if (dataType === 'employees') employees = dataArray;
            else if (dataType === 'attendance') attendance = dataArray;
            else if (dataType === 'leaves') leaves = dataArray;
            else if (dataType === 'financials') financials = dataArray;
            else if (dataType === 'employeeDatabase') employeeDatabase = dataArray;
            else if (dataType === 'cashTransactions') cashTransactions = dataArray;
            else if (dataType === 'stations') stations = dataArray;
            else if (dataType === 'supervisors') supervisors = dataArray;
            else if (dataType === 'faults') faults = dataArray;
            else if (dataType === 'loans') loans = dataArray;
            resolve();
        }).catch(reject);
    });
}

function saveData(dataType, data) {
    return new Promise((resolve, reject) => {
        let dataToSave = {};
        if (Array.isArray(data)) {
            data.forEach(item => {
                if (item.id) { const { id, ...rest } = item; dataToSave[id] = rest; }
                else dataToSave[Date.now().toString()] = item;
            });
        } else dataToSave = data;
        database.ref(dataType).set(dataToSave).then(resolve).catch(reject);
    });
}

function addData(dataType, newItem) {
    return new Promise((resolve, reject) => {
        const newId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
        const itemWithId = { id: newId, ...newItem };
        database.ref(`${dataType}/${newId}`).set(newItem).then(() => {
            if (dataType === 'employees') employees.push(itemWithId);
            else if (dataType === 'attendance') attendance.push(itemWithId);
            else if (dataType === 'leaves') leaves.push(itemWithId);
            else if (dataType === 'financials') financials.push(itemWithId);
            else if (dataType === 'employeeDatabase') employeeDatabase.push(itemWithId);
            else if (dataType === 'cashTransactions') cashTransactions.push(itemWithId);
            else if (dataType === 'stations') stations.push(itemWithId);
            else if (dataType === 'supervisors') supervisors.push(itemWithId);
            else if (dataType === 'faults') faults.push(itemWithId);
            else if (dataType === 'loans') loans.push(itemWithId);
            resolve(itemWithId);
        }).catch(reject);
    });
}

function updateData(dataType, id, updatedData) {
    return new Promise((resolve, reject) => {
        database.ref(`${dataType}/${id}`).update(updatedData).then(() => {
            const arrays = { employees, attendance, leaves, financials, employeeDatabase, cashTransactions, stations, supervisors, faults, loans };
            const arr = arrays[dataType];
            if (arr) { const idx = arr.findIndex(i => i.id === id); if (idx !== -1) arr[idx] = { ...arr[idx], ...updatedData }; }
            resolve();
        }).catch(reject);
    });
}

function deleteData(dataType, id) {
    return new Promise((resolve, reject) => {
        database.ref(`${dataType}/${id}`).remove().then(() => {
            if (dataType === 'employees') employees = employees.filter(i => i.id !== id);
            else if (dataType === 'attendance') attendance = attendance.filter(i => i.id !== id);
            else if (dataType === 'leaves') leaves = leaves.filter(i => i.id !== id);
            else if (dataType === 'financials') financials = financials.filter(i => i.id !== id);
            else if (dataType === 'employeeDatabase') employeeDatabase = employeeDatabase.filter(i => i.id !== id);
            else if (dataType === 'cashTransactions') cashTransactions = cashTransactions.filter(i => i.id !== id);
            else if (dataType === 'stations') stations = stations.filter(i => i.id !== id);
            else if (dataType === 'supervisors') supervisors = supervisors.filter(i => i.id !== id);
            else if (dataType === 'faults') faults = faults.filter(i => i.id !== id);
            else if (dataType === 'loans') loans = loans.filter(i => i.id !== id);
            resolve();
        }).catch(reject);
    });
}

// ======================== UI HELPERS ========================
function showErrorMessage(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-container';
    errorDiv.innerHTML = `<i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: var(--danger);"></i><p style="margin: 15px 0;">${message}</p><button class="retry-button" onclick="location.reload()"><i class="fas fa-sync-alt"></i> إعادة المحاولة</button>`;
    const mainContent = document.querySelector('.main-content');
    mainContent.innerHTML = ''; mainContent.appendChild(errorDiv);
}

function showLoadingState(show) {
    const buttons = document.querySelectorAll('button[type="submit"]');
    if (show) {
        buttons.forEach(button => {
            const textSpan = button.querySelector('span');
            if (textSpan) { textSpan.innerHTML = '<div class="loading"></div> جاري التحميل...'; button.disabled = true; }
        });
        const autoBtn = document.getElementById('autoAttendanceBtn');
        if (autoBtn) { autoBtn.querySelector('span').innerHTML = '<div class="loading"></div> جاري التسجيل...'; autoBtn.disabled = true; }
        const genBtn = document.getElementById('generateReport');
        if (genBtn) { genBtn.querySelector('span').innerHTML = '<div class="loading"></div> جاري إنشاء التقرير...'; genBtn.disabled = true; }
    } else {
        buttons.forEach(button => {
            const textSpan = button.querySelector('span');
            if (textSpan) {
                if (button.closest('#employeeForm')) textSpan.textContent = 'إضافة الموظف';
                else if (button.closest('#employeeDatabaseForm')) textSpan.textContent = 'إضافة إلى قاعدة البيانات';
                else if (button.closest('#manualAttendanceForm')) textSpan.textContent = 'تسجيل';
                else if (button.closest('#financialForm')) textSpan.textContent = 'تسجيل';
                else if (button.closest('#cashDepositForm')) textSpan.innerHTML = '<i class="fas fa-plus-circle"></i> تسجيل إيداع';
                else if (button.closest('#cashWithdrawalForm')) textSpan.innerHTML = '<i class="fas fa-minus-circle"></i> تسجيل صرف';
                else if (button.closest('#faultForm')) textSpan.textContent = 'تسجيل العطل';
                else if (button.closest('#stationForm')) textSpan.textContent = 'إضافة المحطة';
                else if (button.closest('#supervisorForm')) textSpan.textContent = 'إضافة المسؤول';
                button.disabled = false;
            }
        });
        const autoBtn = document.getElementById('autoAttendanceBtn');
        if (autoBtn) { autoBtn.querySelector('span').textContent = 'تسجيل الحضور التلقائي'; autoBtn.disabled = false; }
        const genBtn = document.getElementById('generateReport');
        if (genBtn) { genBtn.querySelector('span').textContent = 'إنشاء التقرير'; genBtn.disabled = false; }
    }
}

function generateRandomPassword() {
    const w1 = arabicWords[Math.floor(Math.random() * arabicWords.length)];
    const w2 = arabicWords[Math.floor(Math.random() * arabicWords.length)];
    return `${w1}_${w2}_${Math.floor(Math.random() * 900) + 100}`;
}

function toggleSideMenu() { sideMenu.classList.toggle('active'); overlay.classList.toggle('active'); }

// ======================== NAVIGATION ========================
function showPage(pageId) {
    document.querySelectorAll('.tab-content').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
    const titles = {
        'dashboard':'لوحة التحكم','employees':'إدارة الموظفين','employee-database':'قاعدة بيانات الموظفين',
        'attendance':'الحضور والغياب','employee-records':'سجل الموظفين','financial':'السلف والمكافآت',
        'loans':'طلبات السلف','reports':'تقارير المرتبات','cash':'إدارة العهدة','faults':'سجل الأعطال',
        'stations':'إدارة المحطات','supervisors':'إدارة المسؤولين','backup':'النسخ الاحتياطي'
    };
    document.getElementById('pageTitle').textContent = titles[pageId] || pageId;
    if (pageId === 'dashboard') { updateDashboard(); displayRecentCashTransactions(); displayRecentLoans(); }
    else if (pageId === 'employees') { displayEmployeesList(); updateDatabaseEmployeesDropdown(); }
    else if (pageId === 'employee-database') displayEmployeeDatabase();
    else if (pageId === 'attendance') displayAttendanceList();
    else if (pageId === 'employee-records') { updateEmployeesDropdowns(); document.getElementById('employeeReportContainer').style.display = 'none'; }
    else if (pageId === 'financial') displayFinancialsList();
    else if (pageId === 'loans') displayLoansList();
    else if (pageId === 'reports') generateSalaryReport();
    else if (pageId === 'cash') { displayCashTransactions(); updateCashSummary(); }
    else if (pageId === 'faults') displayFaultsList();
    else if (pageId === 'stations') displayStationsList();
    else if (pageId === 'supervisors') { displaySupervisorsList(); updateSupervisorEmployeesDropdown(); }
}

function updateBottomNavFromSidebar(target) {
    document.querySelectorAll('.nav-item, .nav-item-attendance').forEach(n => n.classList.remove('active'));
    const navMap = { 'dashboard': '.nav-item[data-target="dashboard"]', 'employees': '.nav-item[data-target="employees"]', 'attendance': '.nav-item-attendance[data-target="attendance"]', 'loans': '.nav-item[data-target="loans"]', 'faults': '.nav-item[data-target="faults"]' };
    if (navMap[target]) { const el = document.querySelector(navMap[target]); if (el) el.classList.add('active'); }
}

// ======================== DROPDOWN UPDATERS ========================
function updateStationDropdowns() {
    const ids = ['attendanceStation','financialStation','faultStation','filterAttendanceStation','filterFinancialStation','filterFaultStation','dashboardStationFilter','cashDepositStation','cashWithdrawalStation','filterLoanStation','reportStationFilter'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = '<option value="">اختر المحطة</option>';
        stations.forEach(s => { const o = document.createElement('option'); o.value = s.name; o.textContent = s.name; el.appendChild(o); });
        if (id.includes('filter') || id === 'dashboardStationFilter' || id === 'reportStationFilter') {
            const all = document.createElement('option'); all.value = ''; all.textContent = 'جميع المحطات'; el.prepend(all);
        }
    });
}

function updateSupervisorDropdowns() {
    const ids = ['attendanceSupervisor','financialSupervisor','faultSupervisor','cashDepositSupervisor','cashWithdrawalSupervisor','filterLoanSupervisor'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = '<option value="">اختر المسؤول</option>';
        supervisors.forEach(s => { if (s.active) { const o = document.createElement('option'); o.value = s.id; o.textContent = s.employeeName; el.appendChild(o); } });
    });
    const f = document.getElementById('filterCashSupervisor');
    if (f) {
        f.innerHTML = '<option value="">جميع المسؤولين</option>';
        supervisors.forEach(s => { if (s.active) { const o = document.createElement('option'); o.value = s.id; o.textContent = s.employeeName; f.appendChild(o); } });
    }
}

function updateCashSupervisorDropdowns() {
    ['cashDepositSupervisor','cashWithdrawalSupervisor'].forEach(id => {
        const el = document.getElementById(id); if (!el) return;
        el.innerHTML = '<option value="">اختر المسؤول</option>';
        supervisors.forEach(s => { if (s.active) { const o = document.createElement('option'); o.value = s.id; o.textContent = s.employeeName; el.appendChild(o); } });
    });
}

function updateEmployeesDropdowns() {
    ['attendanceEmployee','financialEmployee','selectEmployeeForReport','filterFinancialEmployee','reportEmployeeFilter'].forEach(id => {
        const el = document.getElementById(id); if (!el) return;
        el.innerHTML = '<option value="">اختر الموظف</option>';
        employees.forEach(emp => { if (emp.active) { const o = document.createElement('option'); o.value = emp.name; o.textContent = `${emp.name} (${emp.job})`; el.appendChild(o); } });
    });
    initSearchableSelects();
}

function updateDatabaseEmployeesDropdown() {
    const el = document.getElementById('selectMultipleEmployees'); if (!el) return;
    el.innerHTML = '';
    const inactive = employeeDatabase.filter(e => !e.active);
    if (inactive.length === 0) { const o = document.createElement('option'); o.textContent = 'لا يوجد موظفين متاحين للإضافة'; o.disabled = true; el.appendChild(o); }
    else inactive.forEach(emp => { const o = document.createElement('option'); o.value = emp.id; o.textContent = `${emp.name} - ${emp.phone}`; el.appendChild(o); });
    updateSupervisorEmployeesDropdown();
}

function updateSupervisorEmployeesDropdown() {
    const el = document.getElementById('supervisorEmployee'); if (!el) return;
    el.innerHTML = '<option value="">اختر الموظف</option>';
    employeeDatabase.forEach(emp => {
        if (!supervisors.some(s => s.employeeId === emp.id)) {
            const o = document.createElement('option'); o.value = emp.id; o.textContent = `${emp.name} - ${emp.phone}`; el.appendChild(o);
        }
    });
    initSearchableSelects();
}

function updateLoanFilterDropdowns() {
    const stEl = document.getElementById('filterLoanStation');
    if (stEl) { stEl.innerHTML = '<option value="">جميع المحطات</option>'; stations.forEach(s => { const o = document.createElement('option'); o.value = s.name; o.textContent = s.name; stEl.appendChild(o); }); }
    const supEl = document.getElementById('filterLoanSupervisor');
    if (supEl) { supEl.innerHTML = '<option value="">جميع المسؤولين</option>'; supervisors.forEach(s => { const o = document.createElement('option'); o.value = s.id; o.textContent = s.employeeName; supEl.appendChild(o); }); }
}

function updateReportFilterDropdowns() {
    const stEl = document.getElementById('reportStationFilter');
    if (stEl) { stEl.innerHTML = '<option value="">جميع المحطات</option>'; stations.forEach(s => { const o = document.createElement('option'); o.value = s.name; o.textContent = s.name; stEl.appendChild(o); }); }
    const empEl = document.getElementById('reportEmployeeFilter');
    if (empEl) { empEl.innerHTML = '<option value="">جميع الموظفين</option>'; employees.forEach(emp => { if (emp.active) { const o = document.createElement('option'); o.value = emp.name; o.textContent = `${emp.name} (${emp.job})`; empEl.appendChild(o); } }); }
}

// ======================== SALARY CALCULATION ========================
function calculateNetSalary(employee, month) {
    const workDays = attendance.filter(r => r.employeeName === employee.name && r.date.startsWith(month) && r.status === 'حاضر').length;
    const [year, monthNum] = month.split('-').map(Number);
    const daysInMonth = new Date(year, monthNum, 0).getDate();
    const isFebruary = monthNum === 2;
    const dailyRate = employee.salary / 30;
    let baseSalary = 0, extraDays = 0;
    if (isFebruary && workDays < employee.workDays) { baseSalary = employee.salary; }
    else { baseSalary = workDays >= employee.workDays ? employee.salary : workDays * dailyRate; }
    if (workDays > employee.workDays) extraDays = workDays - employee.workDays;
    const extraSalary = extraDays * dailyRate;
    const empFinancials = financials.filter(f => f.employeeName === employee.name && f.date.startsWith(month));
    const rewards = empFinancials.filter(f => f.type === 'مكافأة').reduce((s, f) => s + f.amount, 0);
    const loansVal = empFinancials.filter(f => f.type === 'سلفة').reduce((s, f) => s + f.amount, 0);
    const deductions = empFinancials.filter(f => f.type === 'خصم').reduce((s, f) => s + f.amount, 0);
    const netSalary = Math.round(baseSalary + extraSalary + rewards - loansVal - deductions);
    return { workDays, baseSalary, extraDays, extraSalary, netSalary, dailyRate, isFebruary, daysInMonth, rewards, loans: loansVal, deductions };
}

// ======================== DASHBOARD ========================
function getEmployeeNameWithJob(name) {
    const emp = employees.find(e => e.name === name);
    return emp && emp.job ? `${emp.name} (${emp.job})` : name;
}

function updateStationsBar() {
    const container = document.getElementById('stationsBarContainer');
    const badge = document.getElementById('stationsCountBadge');
    if (!container) return;
    const today = new Date().toISOString().split('T')[0];
    const todayStations = {};
    attendance.forEach(r => {
        if (r.date === today && r.stationName) {
            if (!todayStations[r.stationName]) todayStations[r.stationName] = { present: 0, leave: 0, total: 0 };
            todayStations[r.stationName].total++;
            if (r.status === 'حاضر') todayStations[r.stationName].present++;
            else if (r.status === 'إجازة') todayStations[r.stationName].leave++;
        }
    });
    const sorted = Object.keys(todayStations).sort();
    if (badge) badge.textContent = `${sorted.length} محطة`;
    if (sorted.length === 0) { container.innerHTML = '<div class="empty-state" style="padding:10px;">لا توجد محطات مسجلة لهذا اليوم</div>'; return; }
    container.innerHTML = '';
    sorted.forEach(station => {
        const stats = todayStations[station];
        const pill = document.createElement('div');
        pill.className = 'station-pill' + (stats.present > stats.leave ? ' present' : stats.leave > stats.present ? ' leave' : '');
        pill.innerHTML = `<i class="fas fa-map-marker-alt"></i><span>${station}</span><span class="station-count">${stats.total}</span>`;
        container.appendChild(pill);
    });
}

function updateDashboard() {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const today = new Date().toISOString().split('T')[0];
    const selectedStation = document.getElementById('dashboardStationFilter').value;
    const active = employees.filter(e => e.active);
    if (document.getElementById('totalEmployees')) document.getElementById('totalEmployees').textContent = active.length;
    const todayRec = attendance.filter(r => r.date === today && employees.find(e => e.name === r.employeeName && e.active) && (!selectedStation || r.stationName === selectedStation));
    if (document.getElementById('todayAttendance')) document.getElementById('todayAttendance').textContent = todayRec.length;
    if (document.getElementById('totalStations')) document.getElementById('totalStations').textContent = stations.length;
    const totalDeductions = financials.filter(f => f.type === 'خصم' && f.date.startsWith(currentMonth)).reduce((s, f) => s + f.amount, 0);
    if (document.getElementById('totalDeductions')) document.getElementById('totalDeductions').textContent = totalDeductions + ' ج.م';
    const totalRewards = financials.filter(f => f.type === 'مكافأة' && f.date.startsWith(currentMonth)).reduce((s, f) => s + f.amount, 0);
    if (document.getElementById('monthlyRewards')) document.getElementById('monthlyRewards').textContent = totalRewards + ' ج.م';
    const totalLoansVal = financials.filter(f => f.type === 'سلفة' && f.date.startsWith(currentMonth)).reduce((s, f) => s + f.amount, 0);
    if (document.getElementById('totalLoans')) document.getElementById('totalLoans').textContent = totalLoansVal + ' ج.م';
    const pending = loans.filter(l => l.status === 'قيد الانتظار').length;
    if (document.getElementById('pendingLoans')) document.getElementById('pendingLoans').textContent = pending;
    if (document.getElementById('activeFaults')) document.getElementById('activeFaults').textContent = faults.filter(f => f.status !== 'fixed').length;
    updateCashStats(); updateStationsBar();
    const todayList = document.getElementById('todayAttendanceList');
    if (!todayList) return;
    todayList.innerHTML = '';
    if (todayRec.length === 0) { todayList.innerHTML = '<div class="empty-state">لا توجد سجلات حضور لهذا اليوم</div>'; return; }
    const sorted = [...todayRec].sort((a, b) => { if (a.status === 'حاضر') return -1; if (b.status === 'حاضر') return 1; return 0; });
    const byStation = {};
    sorted.forEach(r => { const st = r.stationName || 'محطة غير محددة'; if (!byStation[st]) byStation[st] = []; byStation[st].push(r); });
    for (const [stName, recs] of Object.entries(byStation)) {
        const pCount = recs.filter(r => r.status === 'حاضر').length;
        const lCount = recs.filter(r => r.status === 'إجازة').length;
        const grp = document.createElement('div'); grp.className = 'station-group';
        grp.innerHTML = `<div class="station-group-header"><div class="station-group-header-top"><span>${stName}</span><span class="station-employee-count">إجمالي: ${recs.length}</span></div><div class="station-group-stats"><span><i class="fas fa-check-circle" style="color:#27ae60;"></i> حضور: ${pCount}</span><span><i class="fas fa-calendar-alt" style="color:#f39c12;"></i> إجازة: ${lCount}</span></div></div><div class="station-group-body"></div>`;
        todayList.appendChild(grp);
        const body = grp.querySelector('.station-group-body');
        recs.forEach(r => {
            const sup = supervisors.find(s => s.id === r.supervisorId);
            const supName = sup ? sup.employeeName : (r.supervisorName || 'غير محدد');
            const statusCls = r.status === 'حاضر' ? 'status-present-badge' : 'status-leave-badge';
            const statusIcon = r.status === 'حاضر' ? '✅ حاضر' : '🌴 إجازة';
            const timeInfo = r.time ? `<span class="attendance-time">${r.time}</span>` : '';
            const item = document.createElement('div'); item.className = 'attendance-item';
            item.innerHTML = `<div class="attendance-employee-info"><div class="attendance-employee-name">${getEmployeeNameWithJob(r.employeeName)}</div><div class="attendance-employee-details"><span>المسؤول: ${supName}</span>${timeInfo}</div></div><div class="attendance-status-badge ${statusCls}">${statusIcon}</div>`;
            body.appendChild(item);
        });
    }
    displayRecentCashTransactions(); displayRecentLoans();
}

// ======================== CASH ========================
function calculateCashBalance() { return cashTransactions.reduce((s, t) => t.type === 'إيداع' ? s + t.amount : s - t.amount, 0); }
function calculateTotalDeposits() { return cashTransactions.filter(t => t.type === 'إيداع').reduce((s, t) => s + t.amount, 0); }
function calculateTotalWithdrawals() { return cashTransactions.filter(t => t.type === 'صرف').reduce((s, t) => s + t.amount, 0); }
function calculateTodayDeposits() { const today = new Date().toISOString().split('T')[0]; return cashTransactions.filter(t => t.type === 'إيداع' && t.date === today).reduce((s, t) => s + t.amount, 0); }
function calculateTodayWithdrawals() { const today = new Date().toISOString().split('T')[0]; return cashTransactions.filter(t => t.type === 'صرف' && t.date === today).reduce((s, t) => s + t.amount, 0); }

function updateCashStats() {
    const balance = calculateCashBalance();
    const box = document.getElementById('cashBalanceBox');
    if (box) { if (balance < 0) box.classList.add('negative-balance'); else box.classList.remove('negative-balance'); }
    if (document.getElementById('dashboardCashBalance')) document.getElementById('dashboardCashBalance').textContent = `${balance} ج.م`;
    if (document.getElementById('dashboardTotalDeposits')) document.getElementById('dashboardTotalDeposits').textContent = `${calculateTotalDeposits()} ج.م`;
    if (document.getElementById('dashboardTotalWithdrawals')) document.getElementById('dashboardTotalWithdrawals').textContent = `${calculateTotalWithdrawals()} ج.م`;
    if (document.getElementById('dashboardTodayDeposits')) document.getElementById('dashboardTodayDeposits').textContent = `${calculateTodayDeposits()} ج.م`;
    if (document.getElementById('dashboardTodayWithdrawals')) document.getElementById('dashboardTodayWithdrawals').textContent = `${calculateTodayWithdrawals()} ج.م`;
}

function updateCashSummary() {
    const balance = calculateCashBalance();
    const el = document.getElementById('currentCashBalance');
    if (el) { el.textContent = `${balance} ج.م`; if (balance < 0) el.classList.add('negative'); else el.classList.remove('negative'); }
    if (document.getElementById('totalDeposits')) document.getElementById('totalDeposits').textContent = `${calculateTotalDeposits()} ج.م`;
    if (document.getElementById('totalWithdrawals')) document.getElementById('totalWithdrawals').textContent = `${calculateTotalWithdrawals()} ج.م`;
}

function addCashDeposit() {
    showLoadingState(true);
    const stationName = document.getElementById('cashDepositStation').value;
    const supervisorId = document.getElementById('cashDepositSupervisor').value;
    const amount = parseInt(document.getElementById('cashDepositAmount').value);
    const date = document.getElementById('cashDepositDate').value;
    const reason = document.getElementById('cashDepositReason').value;
    const notes = document.getElementById('cashDepositNotes').value;
    if (!supervisorId) { alert('يرجى اختيار المسؤول'); showLoadingState(false); return; }
    if (!amount || amount <= 0) { document.getElementById('cashDepositAmountError').style.display = 'block'; showLoadingState(false); return; }
    document.getElementById('cashDepositAmountError').style.display = 'none';
    if (!reason) { alert('يرجى إدخال سبب الإيداع'); showLoadingState(false); return; }
    const sup = supervisors.find(s => s.id === supervisorId);
    addData('cashTransactions', { type: 'إيداع', stationName: stationName || '', supervisorId, supervisorName: sup ? sup.employeeName : 'غير معروف', amount, date, reason, notes: notes || '', timestamp: new Date().toISOString(), time: new Date().toLocaleTimeString('ar-EG', { hour12: false }) })
        .then(() => { document.getElementById('cashDepositForm').reset(); document.getElementById('cashDepositDate').value = new Date().toISOString().split('T')[0]; showLoadingState(false); alert('تم تسجيل الإيداع بنجاح'); loadAllData(); })
        .catch(() => { showLoadingState(false); alert('حدث خطأ أثناء تسجيل الإيداع'); });
}

function addCashWithdrawal() {
    showLoadingState(true);
    const stationName = document.getElementById('cashWithdrawalStation').value;
    const supervisorId = document.getElementById('cashWithdrawalSupervisor').value;
    const amount = parseInt(document.getElementById('cashWithdrawalAmount').value);
    const date = document.getElementById('cashWithdrawalDate').value;
    const reason = document.getElementById('cashWithdrawalReason').value;
    const recipient = document.getElementById('cashWithdrawalRecipient').value;
    const notes = document.getElementById('cashWithdrawalNotes').value;
    if (!supervisorId) { alert('يرجى اختيار المسؤول'); showLoadingState(false); return; }
    if (!amount || amount <= 0) { document.getElementById('cashWithdrawalAmountError').style.display = 'block'; showLoadingState(false); return; }
    document.getElementById('cashWithdrawalAmountError').style.display = 'none';
    if (!reason) { alert('يرجى إدخال سبب الصرف'); showLoadingState(false); return; }
    if (!recipient) { alert('يرجى إدخال اسم المستلم'); showLoadingState(false); return; }
    const sup = supervisors.find(s => s.id === supervisorId);
    addData('cashTransactions', { type: 'صرف', stationName: stationName || '', supervisorId, supervisorName: sup ? sup.employeeName : 'غير معروف', amount, date, reason, recipient, notes: notes || '', timestamp: new Date().toISOString(), time: new Date().toLocaleTimeString('ar-EG', { hour12: false }) })
        .then(() => { document.getElementById('cashWithdrawalForm').reset(); document.getElementById('cashWithdrawalDate').value = new Date().toISOString().split('T')[0]; showLoadingState(false); const newBal = calculateCashBalance() - amount; if (newBal < 0) alert('تم تسجيل الصرف - الرصيد أصبح سالباً'); else alert('تم تسجيل الصرف بنجاح'); loadAllData(); })
        .catch(() => { showLoadingState(false); alert('حدث خطأ أثناء تسجيل الصرف'); });
}

function displayCashTransactions() {
    const container = document.getElementById('cashTransactionsList'); if (!container) return; container.innerHTML = '';
    const dateFilter = document.getElementById('filterCashDate').value;
    const typeFilter = document.getElementById('filterCashType').value;
    const supFilter = document.getElementById('filterCashSupervisor').value;
    let filtered = [...cashTransactions];
    if (dateFilter) filtered = filtered.filter(t => t.date === dateFilter);
    if (typeFilter) filtered = filtered.filter(t => t.type === typeFilter);
    if (supFilter) filtered = filtered.filter(t => t.supervisorId === supFilter);
    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
    if (filtered.length === 0) { container.innerHTML = '<div class="empty-state">لا توجد حركات للعهدة</div>'; return; }
    filtered.forEach(t => {
        const sup = supervisors.find(s => s.id === t.supervisorId);
        const supName = sup ? sup.employeeName : (t.supervisorName || 'غير معروف');
        const amountCls = t.type === 'إيداع' ? 'cash-positive' : 'cash-negative';
        const sign = t.type === 'إيداع' ? '+' : '-';
        const details = t.type === 'إيداع' ? `سبب الإيداع: ${t.reason}` : `سبب الصرف: ${t.reason} - المستلم: ${t.recipient}`;
        const timeInfo = t.time ? `<span class="time-badge">${t.time}</span>` : '';
        const item = document.createElement('div'); item.className = 'list-item';
        item.innerHTML = `<div class="item-info"><div class="item-title">${details}</div><div class="item-subtitle"><span>${t.date}</span>${timeInfo}<span>${t.type}</span>${t.stationName ? `<span class="station-badge">${t.stationName}</span>` : ''}</div><div class="item-subtitle">المسؤول: ${supName}</div>${t.notes ? `<div class="item-subtitle">ملاحظات: ${t.notes}</div>` : ''}</div><div class="${amountCls}">${sign} ${t.amount} ج.م</div>`;
        container.appendChild(item);
    });
}

function displayRecentCashTransactions() {
    const container = document.getElementById('recentCashTransactions'); if (!container) return;
    const recent = [...cashTransactions].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
    if (recent.length === 0) { container.innerHTML = '<div class="empty-state">لا توجد حركات عهدة حديثة</div>'; return; }
    let html = '';
    recent.forEach(t => {
        const cls = t.type === 'إيداع' ? 'cash-positive' : 'cash-negative';
        const sign = t.type === 'إيداع' ? '+' : '-';
        const details = t.type === 'إيداع' ? `إيداع: ${t.reason}` : `صرف: ${t.reason}`;
        html += `<div class="list-item"><div class="item-info"><div class="item-title">${details}</div><div class="item-subtitle"><span>${t.date}</span>${t.stationName ? `<span class="station-badge">${t.stationName}</span>` : ''}</div></div><div class="${cls}">${sign} ${t.amount} ج.م</div></div>`;
    });
    container.innerHTML = html;
}

// ======================== LOANS ========================
function displayLoansList() {
    updateLoanStats();
    const tbody = document.getElementById('loansTableBody'); if (!tbody) return; tbody.innerHTML = '';
    const filtered = filterLoansData();
    if (filtered.length === 0) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;">لا توجد طلبات سلفة تطابق معايير البحث</td></tr>'; return; }
    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
    filtered.forEach(loan => {
        const statusCls = loan.status === 'قيد الانتظار' ? 'status-loan-pending' : loan.status === 'تمت الموافقة' ? 'status-loan-approved' : 'status-loan-rejected';
        const sup = supervisors.find(s => s.id === loan.supervisorId);
        const supName = sup ? sup.employeeName : (loan.supervisorName || 'غير معروف');
        const row = document.createElement('tr');
        row.innerHTML = `<td>${supName}</td><td><span class="station-badge">${loan.stationName}</span></td><td>${loan.amount} ج.م</td><td>${loan.reason || 'بدون سبب'}</td><td>${loan.date}</td><td>${loan.recordTime || '-'}</td><td><span class="${statusCls}">${loan.status}</span></td><td><div class="loan-actions"><button class="btn-edit" onclick="openLoanModal('${loan.id}')">تحديث</button><button class="btn-whatsapp" onclick="sendLoanWhatsApp('${loan.id}')"><i class="fab fa-whatsapp"></i></button></div></td>`;
        tbody.appendChild(row);
    });
}

function updateLoanStats() {
    const p = loans.filter(l => l.status === 'قيد الانتظار').length;
    const a = loans.filter(l => l.status === 'تمت الموافقة').length;
    const r = loans.filter(l => l.status === 'مرفوضة').length;
    if (document.getElementById('pendingLoansCount')) document.getElementById('pendingLoansCount').textContent = p;
    if (document.getElementById('approvedLoansCount')) document.getElementById('approvedLoansCount').textContent = a;
    if (document.getElementById('rejectedLoansCount')) document.getElementById('rejectedLoansCount').textContent = r;
    if (document.getElementById('pendingLoans')) document.getElementById('pendingLoans').textContent = p;
}

function filterLoansData() {
    let filtered = [...loans];
    if (currentLoanFilter === 'pending') filtered = filtered.filter(l => l.status === 'قيد الانتظار');
    else if (currentLoanFilter === 'approved') filtered = filtered.filter(l => l.status === 'تمت الموافقة');
    else if (currentLoanFilter === 'rejected') filtered = filtered.filter(l => l.status === 'مرفوضة');
    const stEl = document.getElementById('filterLoanStation'); if (stEl && stEl.value) filtered = filtered.filter(l => l.stationName === stEl.value);
    const supEl = document.getElementById('filterLoanSupervisor'); if (supEl && supEl.value) filtered = filtered.filter(l => l.supervisorId === supEl.value);
    const start = document.getElementById('filterLoanStartDate').value;
    const end = document.getElementById('filterLoanEndDate').value;
    if (start && end) filtered = filtered.filter(l => l.date >= start && l.date <= end);
    return filtered;
}

function filterLoans(filter) {
    currentLoanFilter = filter;
    document.querySelectorAll('.loan-filter-tab').forEach(t => t.classList.remove('active'));
    const tabMap = { pending: 0, approved: 1, rejected: 2, all: 3 };
    const tabs = document.querySelectorAll('.loan-filter-tab');
    if (tabs[tabMap[filter]]) tabs[tabMap[filter]].classList.add('active');
    displayLoansList();
}

function applyLoanFilters() { displayLoansList(); }

function resetLoanFilters() {
    document.getElementById('filterLoanStation').value = '';
    document.getElementById('filterLoanSupervisor').value = '';
    const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    document.getElementById('filterLoanStartDate').value = firstDay;
    document.getElementById('filterLoanEndDate').value = new Date().toISOString().split('T')[0];
    displayLoansList();
}

function openLoanModal(loanId) {
    const loan = loans.find(l => l.id === loanId); if (!loan) return;
    document.getElementById('loanId').value = loan.id;
    document.getElementById('loanStatus').value = loan.status;
    const sup = supervisors.find(s => s.id === loan.supervisorId);
    const supName = sup ? sup.employeeName : (loan.supervisorName || 'غير معروف');
    document.getElementById('loanDetailsCard').innerHTML = `<div class="loan-detail-row"><span class="loan-detail-label">المسؤول:</span><span class="loan-detail-value">${supName}</span></div><div class="loan-detail-row"><span class="loan-detail-label">المحطة:</span><span class="loan-detail-value">${loan.stationName}</span></div><div class="loan-detail-row"><span class="loan-detail-label">المبلغ:</span><span class="loan-detail-value">${loan.amount} ج.م</span></div><div class="loan-detail-row"><span class="loan-detail-label">السبب:</span><span class="loan-detail-value">${loan.reason || 'بدون سبب'}</span></div>`;
    document.getElementById('updateLoanModal').classList.add('active');
}

function closeLoanModal() { document.getElementById('updateLoanModal').classList.remove('active'); }

function updateLoanStatus() {
    const id = document.getElementById('loanId').value;
    const status = document.getElementById('loanStatus').value;
    const notes = document.getElementById('loanAdminNotes').value;
    if (!id || !status) { alert('يرجى اختيار الحالة'); return; }
    updateData('loans', id, { status, adminNotes: notes || '', updatedAt: new Date().toISOString() })
        .then(() => { closeLoanModal(); alert('تم تحديث حالة السلفة بنجاح'); loadAllData(); })
        .catch(() => alert('حدث خطأ أثناء تحديث حالة السلفة'));
}

function sendLoanWhatsApp(loanId) {
    const loan = loans.find(l => l.id === loanId); if (!loan) return;
    const sup = supervisors.find(s => s.id === loan.supervisorId);
    const supName = sup ? sup.employeeName : (loan.supervisorName || 'غير معروف');
    const emoji = loan.status === 'قيد الانتظار' ? '⏳' : loan.status === 'تمت الموافقة' ? '✅' : '❌';
    const msg = `💰 *طلب سلفة* 💰\n\n👤 *المسؤول:* ${supName}\n📍 *المحطة:* ${loan.stationName}\n💵 *المبلغ:* ${loan.amount} ج.م\n📝 *السبب:* ${loan.reason || 'غير محدد'}\n📅 *تاريخ الطلب:* ${loan.date}\n📊 *الحالة:* ${emoji} ${loan.status}${loan.adminNotes ? `\n📋 *ملاحظات الإدارة:* ${loan.adminNotes}` : ''}`;
    window.open(`https://wa.me/201286223499?text=${encodeURIComponent(msg)}`, '_blank');
}

function displayRecentLoans() {
    const container = document.getElementById('recentLoans'); if (!container) return;
    const recent = [...loans].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
    if (recent.length === 0) { container.innerHTML = '<div class="empty-state">لا توجد طلبات سلفة حديثة</div>'; return; }
    let html = '';
    recent.forEach(loan => {
        const sup = supervisors.find(s => s.id === loan.supervisorId);
        const supName = sup ? sup.employeeName : (loan.supervisorName || 'غير معروف');
        const statusCls = loan.status === 'قيد الانتظار' ? 'status-loan-pending' : loan.status === 'تمت الموافقة' ? 'status-loan-approved' : 'status-loan-rejected';
        html += `<div class="list-item"><div class="item-info"><div class="item-title">💰 ${loan.amount} ج.م - ${loan.stationName}</div><div class="item-subtitle"><span>${loan.date}</span><span class="${statusCls}">${loan.status}</span><span>المسؤول: ${supName}</span></div></div></div>`;
    });
    container.innerHTML = html;
}

// ======================== EMPLOYEES ========================
function checkDuplicate(arr, field, value, errorId, inputId) {
    const isDup = arr.some(e => e[field] === value);
    document.getElementById(errorId).style.display = isDup ? 'block' : 'none';
    if (inputId) { const el = document.getElementById(inputId); if (el) { if (isDup) el.classList.add('input-error'); else el.classList.remove('input-error'); } }
    return isDup;
}

function addEmployee() {
    showLoadingState(true);
    const name = document.getElementById('empName').value;
    const phone = document.getElementById('empPhone').value;
    const job = document.getElementById('empJob').value;
    const salary = parseInt(document.getElementById('empSalary').value);
    const workDays = parseInt(document.getElementById('empWorkDays').value);
    const active = document.getElementById('empActive').value === 'true';
    const existing = employeeDatabase.find(e => e.name === name || e.phone === phone);
    if (!existing) { showLoadingState(false); alert('يجب إضافة الموظف أولاً في قاعدة البيانات'); showPage('employee-database'); return; }
    if (employees.some(e => e.name === name)) { document.getElementById('empNameError').style.display = 'block'; showLoadingState(false); return; }
    if (employees.some(e => e.phone === phone)) { document.getElementById('empPhoneError').style.display = 'block'; showLoadingState(false); return; }
    addData('employees', { name, phone, job, salary, workDays, active, attendanceDays: 0, address: existing.address || '', whatsapp: existing.whatsapp || phone })
        .then(() => updateData('employeeDatabase', existing.id, { active: true }))
        .then(() => { document.getElementById('employeeForm').reset(); document.getElementById('empWorkDays').value = 24; showLoadingState(false); alert('تم إضافة الموظف بنجاح'); loadAllData(); })
        .catch(() => { showLoadingState(false); alert('حدث خطأ أثناء إضافة الموظف'); });
}

function addEmployeeToDatabase() {
    showLoadingState(true);
    const name = document.getElementById('dbEmpName').value;
    const phone = document.getElementById('dbEmpPhone').value;
    if (employeeDatabase.some(e => e.name === name)) { document.getElementById('dbEmpNameError').style.display = 'block'; showLoadingState(false); return; }
    if (employeeDatabase.some(e => e.phone === phone)) { document.getElementById('dbEmpPhoneError').style.display = 'block'; showLoadingState(false); return; }
    addData('employeeDatabase', { name, phone, whatsapp: document.getElementById('dbEmpWhatsapp').value || phone, address: document.getElementById('dbEmpAddress').value, job: '', salary: 0, workDays: 24, active: false, attendanceDays: 0 })
        .then(() => { document.getElementById('employeeDatabaseForm').reset(); showLoadingState(false); alert('تم إضافة الموظف إلى قاعدة البيانات بنجاح'); loadAllData(); })
        .catch(() => { showLoadingState(false); alert('حدث خطأ أثناء إضافة الموظف'); });
}

function displayEmployeesList(searchTerm = '') {
    const container = document.getElementById('employeesList');
    const resultsCount = document.getElementById('searchResultsCount');
    container.innerHTML = '';
    let filtered = employees;
    if (searchTerm.trim()) { const term = searchTerm.trim().toLowerCase(); filtered = employees.filter(e => e.name.toLowerCase().includes(term) || e.phone.includes(term) || (e.job && e.job.toLowerCase().includes(term))); }
    if (resultsCount) resultsCount.textContent = searchTerm.trim() ? `نتائج البحث: ${filtered.length} موظف` : `عرض جميع الموظفين (${filtered.length})`;
    if (filtered.length === 0) { container.innerHTML = '<div class="empty-state">لا توجد نتائج تطابق البحث</div>'; return; }
    filtered.forEach(emp => {
        const statusCls = emp.active ? 'status-active' : 'status-inactive';
        const item = document.createElement('div'); item.className = 'employee-item';
        item.innerHTML = `<div class="employee-item-header"><div class="employee-name-badge"><h3>${emp.name}</h3><span class="employee-badge">${emp.job}</span><span class="employee-status ${statusCls}">${emp.active ? 'فعال' : 'غير فعال'}</span></div></div><div class="employee-contact"><span><i class="fas fa-phone"></i> ${emp.phone}</span>${emp.whatsapp ? `<span><i class="fab fa-whatsapp"></i> ${emp.whatsapp}</span>` : ''}<span><i class="fas fa-money-bill"></i> ${emp.salary} ج.م</span><span><i class="fas fa-calendar"></i> ${emp.workDays} يوم</span></div><div class="employee-actions-grid"><button class="btn-history" onclick="showEmployeeHistory('${emp.name}')"><i class="fas fa-history"></i> السجل</button><button class="btn-edit" onclick="openEditEmployeeModal('${emp.id}')"><i class="fas fa-edit"></i> تعديل</button>${emp.active ? `<button class="btn-deactivate" onclick="toggleEmployeeStatus('${emp.id}')"><i class="fas fa-ban"></i> تعطيل</button>` : `<button class="btn-activate" onclick="toggleEmployeeStatus('${emp.id}')"><i class="fas fa-check"></i> تفعيل</button>`}<button class="btn-whatsapp" onclick="sendWhatsAppToEmployee('${emp.whatsapp || emp.phone}')"><i class="fab fa-whatsapp"></i></button><button class="btn-call" onclick="callEmployee('${emp.phone}')"><i class="fas fa-phone"></i></button><button class="btn-delete" onclick="deleteEmployee('${emp.id}')"><i class="fas fa-trash"></i></button></div>`;
        container.appendChild(item);
    });
}

function displayEmployeeDatabase() {
    const container = document.getElementById('employeeDatabaseList'); container.innerHTML = '';
    const searchTerm = document.getElementById('searchEmployee').value.toLowerCase();
    const filtered = employeeDatabase.filter(e => e.name.toLowerCase().includes(searchTerm) || e.phone.includes(searchTerm));
    if (filtered.length === 0) { container.innerHTML = '<div class="empty-state">لا يوجد موظفين مسجلين</div>'; return; }
    filtered.forEach(emp => {
        const card = document.createElement('div'); card.className = 'employee-details-card';
        card.innerHTML = `<div class="employee-details-header">${emp.name}${emp.job ? ` (${emp.job})` : ''}<div class="employee-status ${emp.active ? 'status-active' : 'status-inactive'}">${emp.active ? 'مفعل' : 'غير مفعل'}</div></div><div class="employee-details-body"><div class="employee-info-grid"><div class="info-item"><span class="info-label">رقم الهاتف:</span><span class="info-value">${emp.phone}</span></div><div class="info-item"><span class="info-label">رقم الواتساب:</span><span class="info-value">${emp.whatsapp || emp.phone}</span></div><div class="info-item"><span class="info-label">العنوان:</span><span class="info-value">${emp.address || 'غير محدد'}</span></div></div><div class="employee-actions"><button class="btn-call" onclick="callEmployee('${emp.phone}')"><i class="fas fa-phone"></i> اتصل</button><button class="btn-whatsapp" onclick="sendWhatsAppToEmployee('${emp.whatsapp || emp.phone}')"><i class="fab fa-whatsapp"></i> واتساب</button>${!emp.active ? `<button class="btn-activate" onclick="activateEmployeeFromDatabase('${emp.id}')">تفعيل</button>` : `<button class="btn-success" disabled>مفعل</button>`}<button class="btn-edit" onclick="editEmployeeInDatabase('${emp.id}')">تعديل</button><button class="btn-delete" onclick="deleteEmployeeFromDatabase('${emp.id}')">حذف</button></div></div>`;
        container.appendChild(card);
    });
}

function openEditEmployeeModal(id) {
    const emp = employees.find(e => e.id === id); if (!emp) return;
    document.getElementById('editEmpId').value = emp.id;
    document.getElementById('editEmpName').value = emp.name;
    document.getElementById('editEmpPhone').value = emp.phone;
    document.getElementById('editEmpJob').value = emp.job;
    document.getElementById('editEmpSalary').value = emp.salary;
    document.getElementById('editEmpWorkDays').value = emp.workDays;
    document.getElementById('editEmpActive').value = emp.active.toString();
    document.getElementById('editEmployeeModal').classList.add('active');
}

function closeEditModal() { document.getElementById('editEmployeeModal').classList.remove('active'); }

function saveEmployeeEdit() {
    const id = document.getElementById('editEmpId').value;
    const name = document.getElementById('editEmpName').value;
    const phone = document.getElementById('editEmpPhone').value;
    const job = document.getElementById('editEmpJob').value;
    const salary = parseInt(document.getElementById('editEmpSalary').value);
    const workDays = parseInt(document.getElementById('editEmpWorkDays').value);
    const active = document.getElementById('editEmpActive').value === 'true';
    if (!name || !phone || !job || !salary || !workDays) { alert('يرجى ملء جميع الحقول'); return; }
    if (employees.some(e => e.name === name && e.id !== id)) { document.getElementById('editEmpNameError').style.display = 'block'; return; }
    document.getElementById('editEmpNameError').style.display = 'none';
    if (employees.some(e => e.phone === phone && e.id !== id)) { document.getElementById('editEmpPhoneError').style.display = 'block'; return; }
    document.getElementById('editEmpPhoneError').style.display = 'none';
    updateData('employees', id, { name, phone, job, salary, workDays, active })
        .then(() => { closeEditModal(); alert('تم تعديل بيانات الموظف بنجاح'); loadAllData(); })
        .catch(() => alert('حدث خطأ أثناء تعديل بيانات الموظف'));
}

function toggleEmployeeStatus(id) {
    const emp = employees.find(e => e.id === id); if (!emp) return;
    if (!emp.active) { updateData('employees', id, { active: true }).then(() => { alert('تم تفعيل الموظف بنجاح'); loadAllData(); }); }
    else if (confirm('سيتم تعطيل الموظف ونقله إلى قاعدة البيانات. هل تريد المتابعة؟')) moveEmployeeToDatabase(emp);
}

function moveEmployeeToDatabase(emp) {
    const existing = employeeDatabase.find(e => e.phone === emp.phone);
    const updateOrAdd = existing
        ? updateData('employeeDatabase', existing.id, { name: emp.name, phone: emp.phone, whatsapp: emp.whatsapp || emp.phone, job: emp.job, address: emp.address || '', active: false })
        : addData('employeeDatabase', { name: emp.name, phone: emp.phone, whatsapp: emp.whatsapp || emp.phone, job: emp.job, address: emp.address || '', salary: emp.salary, workDays: emp.workDays, active: false });
    updateOrAdd.then(() => deleteData('employees', emp.id)).then(() => { alert('تم نقل الموظف إلى قاعدة البيانات بنجاح'); loadAllData(); }).catch(() => alert('حدث خطأ أثناء نقل الموظف'));
}

function activateEmployeeFromDatabase(id) {
    const emp = employeeDatabase.find(e => e.id === id); if (!emp) return;
    if (employees.some(e => e.phone === emp.phone)) { alert('هذا الموظف موجود بالفعل في قائمة الموظفين النشطين'); return; }
    addData('employees', { name: emp.name, phone: emp.phone, job: emp.job || '', salary: emp.salary || 0, workDays: emp.workDays || 24, active: true, attendanceDays: 0 })
        .then(() => updateData('employeeDatabase', emp.id, { active: true }))
        .then(() => { alert('تم تفعيل الموظف بنجاح'); loadAllData(); })
        .catch(() => alert('حدث خطأ أثناء تفعيل الموظف'));
}

function deleteEmployee(id) {
    if (!confirm('هل أنت متأكد من حذف هذا الموظف؟')) return;
    const emp = employees.find(e => e.id === id); if (!emp) return;
    if (!confirm(`سيتم حذف الموظف وجميع بياناته. هل تريد المتابعة؟`)) return;
    deleteData('employees', id).then(() => {
        const promises = [
            ...attendance.filter(r => r.employeeName === emp.name).map(r => deleteData('attendance', r.id)),
            ...leaves.filter(l => l.employeeName === emp.name).map(l => deleteData('leaves', l.id)),
            ...financials.filter(f => f.employeeName === emp.name).map(f => deleteData('financials', f.id))
        ];
        Promise.allSettled(promises).then(() => { alert('تم حذف الموظف وجميع بياناته'); loadAllData(); });
    }).catch(() => alert('حدث خطأ أثناء حذف الموظف'));
}

function editEmployeeInDatabase(id) {
    const emp = employeeDatabase.find(e => e.id === id); if (!emp) return;
    const newName = prompt('أدخل اسم الموظف:', emp.name); if (newName !== null) emp.name = newName;
    const newPhone = prompt('أدخل رقم الهاتف:', emp.phone); if (newPhone !== null) emp.phone = newPhone;
    const newWhatsapp = prompt('أدخل رقم الواتساب:', emp.whatsapp || emp.phone); if (newWhatsapp !== null) emp.whatsapp = newWhatsapp;
    const newJob = prompt('أدخل الوظيفة:', emp.job || ''); if (newJob !== null) emp.job = newJob;
    const newAddress = prompt('أدخل العنوان:', emp.address || ''); if (newAddress !== null) emp.address = newAddress;
    updateData('employeeDatabase', id, emp).then(() => { alert('تم التحديث بنجاح'); loadAllData(); }).catch(() => alert('حدث خطأ'));
}

function deleteEmployeeFromDatabase(id) {
    if (!confirm('هل أنت متأكد من الحذف؟')) return;
    deleteData('employeeDatabase', id).then(() => { alert('تم الحذف بنجاح'); loadAllData(); }).catch(() => alert('حدث خطأ'));
}

function callEmployee(phone) { window.open(`tel:${phone}`, '_self'); }
function sendWhatsAppToEmployee(phone) { window.open(`https://wa.me/${phone}?text=${encodeURIComponent('مرحباً، أود التواصل معك بخصوص العمل')}`, '_blank'); }
function showEmployeeHistory(name) { showPage('employee-records'); const el = document.getElementById('selectEmployeeForReport'); if (el) { for (let o of el.options) if (o.value === name) { o.selected = true; break; } } const m = document.getElementById('selectMonthForReport'); if (m && !m.value) m.value = new Date().toISOString().slice(0, 7); setTimeout(generateEmployeeReport, 500); }

// ======================== ATTENDANCE ========================
function recordManualAttendance() {
    showLoadingState(true);
    const empName = document.getElementById('attendanceEmployee').value;
    const station = document.getElementById('attendanceStation').value;
    const supId = document.getElementById('attendanceSupervisor').value;
    const date = document.getElementById('attendanceDate').value;
    const status = document.getElementById('attendanceStatus').value;
    if (!empName || !station || !supId || !date || !status) { alert('يرجى ملء جميع الحقول'); showLoadingState(false); return; }
    const sup = supervisors.find(s => s.id === supId);
    const existing = attendance.find(r => r.employeeName === empName && r.date === date);
    const time = new Date().toLocaleTimeString('ar-EG', { hour12: false });
    const data = { status, stationName: station, supervisorId: supId, supervisorName: sup ? sup.employeeName : 'غير معروف', time, timestamp: new Date().toISOString() };
    const promise = existing ? updateData('attendance', existing.id, data) : addData('attendance', { employeeName: empName, date, ...data });
    promise.then(() => { showLoadingState(false); alert('تم تسجيل الحضور بنجاح'); loadAllData(); }).catch(() => { showLoadingState(false); alert('حدث خطأ أثناء تسجيل الحضور'); });
}

function recordAutoAttendance() {
    showLoadingState(true);
    const today = new Date().toISOString().split('T')[0];
    const time = new Date().toLocaleTimeString('ar-EG', { hour12: false });
    const promises = [];
    employees.forEach(emp => {
        if (!emp.active) return;
        if (attendance.find(r => r.employeeName === emp.name && r.date === today)) return;
        const onLeave = leaves.some(l => { const s = new Date(l.start), e = new Date(l.end), t = new Date(today); return l.employeeName === emp.name && t >= s && t <= e; });
        promises.push(addData('attendance', { employeeName: emp.name, stationName: '', supervisorId: '', supervisorName: 'تلقائي', date: today, status: onLeave ? 'إجازة' : 'حاضر', time, timestamp: new Date().toISOString() }));
    });
    if (promises.length === 0) { showLoadingState(false); alert('تم تسجيل الحضور بالفعل لجميع الموظفين لهذا اليوم'); return; }
    Promise.all(promises).then(() => { showLoadingState(false); alert(`تم تسجيل الحضور التلقائي لـ ${promises.length} موظف`); loadAllData(); }).catch(() => { showLoadingState(false); alert('حدث خطأ أثناء التسجيل التلقائي'); });
}

function displayAttendanceList() {
    const container = document.getElementById('attendanceList'); container.innerHTML = '';
    const month = document.getElementById('filterAttendanceMonth').value;
    const station = document.getElementById('filterAttendanceStation').value;
    if (!month) { container.innerHTML = '<div class="empty-state">يرجى اختيار شهر</div>'; return; }
    let filtered = attendance.filter(r => r.date.startsWith(month));
    if (station) filtered = filtered.filter(r => r.stationName === station);
    const stats = {};
    filtered.forEach(r => {
        if (!stats[r.employeeName]) stats[r.employeeName] = { present: 0, absent: 0, leave: 0, station: r.stationName || 'غير محدد' };
        if (r.status === 'حاضر') stats[r.employeeName].present++;
        else if (r.status === 'غائب') stats[r.employeeName].absent++;
        else if (r.status === 'إجازة') stats[r.employeeName].leave++;
    });
    if (Object.keys(stats).length === 0) { container.innerHTML = '<div class="empty-state">لا توجد سجلات</div>'; return; }
    for (const [name, s] of Object.entries(stats)) {
        const item = document.createElement('div'); item.className = 'list-item';
        item.innerHTML = `<div class="item-info"><div class="item-title">${getEmployeeNameWithJob(name)}</div><div class="item-subtitle"><span class="station-badge">${s.station}</span></div><div class="item-subtitle"><span>حضور: ${s.present}</span><span>إجازة: ${s.leave}</span><span>غياب: ${s.absent}</span></div></div><div class="item-actions"><button class="btn-whatsapp" onclick="sendWhatsAppMessage('${name}','${month}')"><i class="fab fa-whatsapp"></i> إرسال</button></div>`;
        container.appendChild(item);
    }
}

// ======================== FINANCIALS ========================
function addFinancial() {
    showLoadingState(true);
    const empName = document.getElementById('financialEmployee').value;
    const station = document.getElementById('financialStation').value;
    const supId = document.getElementById('financialSupervisor').value;
    const type = document.getElementById('financialType').value;
    const amount = parseInt(document.getElementById('financialAmount').value);
    const date = document.getElementById('financialDate').value;
    const notes = document.getElementById('financialNotes').value;
    if (!empName || !station || !supId || !type || !amount || !date) { alert('يرجى ملء جميع الحقول'); showLoadingState(false); return; }
    const sup = supervisors.find(s => s.id === supId);
    addData('financials', { employeeName: empName, stationName: station, supervisorId: supId, supervisorName: sup ? sup.employeeName : 'غير معروف', type, amount, date, notes, timestamp: new Date().toISOString(), time: new Date().toLocaleTimeString('ar-EG', { hour12: false }) })
        .then(() => { document.getElementById('financialForm').reset(); document.getElementById('financialDate').value = new Date().toISOString().split('T')[0]; showLoadingState(false); alert('تم تسجيل الحركة المالية بنجاح'); loadAllData(); })
        .catch(() => { showLoadingState(false); alert('حدث خطأ'); });
}

function displayFinancialsList() {
    const container = document.getElementById('financialList'); container.innerHTML = '';
    const month = document.getElementById('filterFinancialMonth')?.value || '';
    const emp = document.getElementById('filterFinancialEmployee')?.value || '';
    const station = document.getElementById('filterFinancialStation')?.value || '';
    const type = document.getElementById('filterFinancialType')?.value || '';
    let filtered = financials;
    if (month) filtered = filtered.filter(f => f.date.startsWith(month));
    if (emp) filtered = filtered.filter(f => f.employeeName === emp);
    if (station) filtered = filtered.filter(f => f.stationName === station);
    if (type) filtered = filtered.filter(f => f.type === type);
    if (filtered.length === 0) { container.innerHTML = '<div class="empty-state">لا توجد حركات مالية مسجلة</div>'; return; }
    filtered.forEach(f => {
        const sup = supervisors.find(s => s.id === f.supervisorId);
        const item = document.createElement('div'); item.className = 'list-item';
        item.innerHTML = `<div class="item-info"><div class="item-title">${getEmployeeNameWithJob(f.employeeName)}</div><div class="item-subtitle"><span class="station-badge">${f.stationName || 'غير محدد'}</span><span>${f.type} - ${f.amount} ج.م</span></div><div class="item-subtitle"><span>${f.date}</span><span class="time-badge">${f.time || ''}</span><span>المسؤول: ${sup ? sup.employeeName : (f.supervisorName || 'غير محدد')}</span></div></div><div class="item-actions"><button class="btn-edit" onclick="editFinancial('${f.id}')">تعديل</button><button class="btn-delete" onclick="deleteFinancial('${f.id}')">حذف</button></div>`;
        container.appendChild(item);
    });
}

function editFinancial(id) {
    const f = financials.find(x => x.id === id); if (!f) return;
    document.getElementById('financialEmployee').value = f.employeeName;
    document.getElementById('financialType').value = f.type;
    document.getElementById('financialAmount').value = f.amount;
    document.getElementById('financialDate').value = f.date;
    document.getElementById('financialNotes').value = f.notes;
    deleteData('financials', id).then(() => { alert('يمكنك الآن تعديل الحركة المالية'); showPage('financial'); loadAllData(); }).catch(() => alert('حدث خطأ'));
}

function deleteFinancial(id) { if (!confirm('هل أنت متأكد من الحذف؟')) return; deleteData('financials', id).then(() => { alert('تم الحذف بنجاح'); loadAllData(); }).catch(() => alert('حدث خطأ')); }

// ======================== STATIONS ========================
function addStation() {
    showLoadingState(true);
    const name = document.getElementById('stationName').value;
    const type = document.getElementById('stationType').value;
    const gov = document.getElementById('stationGovernorate').value;
    const area = document.getElementById('stationArea').value;
    const address = document.getElementById('stationAddress').value;
    if (!name || !type || !gov || !area || !address) { alert('يرجى ملء جميع الحقول'); showLoadingState(false); return; }
    addData('stations', { name, type, governorate: gov, area, address, createdAt: new Date().toISOString() })
        .then(() => { document.getElementById('stationForm').reset(); showLoadingState(false); alert('تم إضافة المحطة بنجاح'); loadAllData(); })
        .catch(() => { showLoadingState(false); alert('حدث خطأ'); });
}

function displayStationsList() {
    const container = document.getElementById('stationsList'); container.innerHTML = '';
    if (stations.length === 0) { container.innerHTML = '<div class="empty-state">لا توجد محطات مسجلة</div>'; return; }
    stations.forEach(s => {
        const item = document.createElement('div'); item.className = 'list-item';
        item.innerHTML = `<div class="item-info"><div class="item-title">${s.name}</div><div class="item-subtitle"><span class="station-type">${s.type}</span></div><div class="item-subtitle"><span>${s.governorate} - ${s.area}</span></div><div class="item-subtitle">${s.address}</div></div><div class="item-actions"><button class="btn-edit" onclick="editStation('${s.id}')">تعديل</button><button class="btn-delete" onclick="deleteStation('${s.id}')">حذف</button></div>`;
        container.appendChild(item);
    });
}

function editStation(id) {
    const s = stations.find(x => x.id === id); if (!s) return;
    document.getElementById('stationName').value = s.name; document.getElementById('stationType').value = s.type;
    document.getElementById('stationGovernorate').value = s.governorate; document.getElementById('stationArea').value = s.area;
    document.getElementById('stationAddress').value = s.address;
    deleteData('stations', id).then(() => { alert('يمكنك الآن تعديل بيانات المحطة'); showPage('stations'); loadAllData(); }).catch(() => alert('حدث خطأ'));
}

function deleteStation(id) { if (!confirm('هل أنت متأكد؟')) return; deleteData('stations', id).then(() => { alert('تم الحذف بنجاح'); loadAllData(); }); }

// ======================== SUPERVISORS ========================
function addSupervisor() {
    showLoadingState(true);
    const empId = document.getElementById('supervisorEmployee').value;
    const password = document.getElementById('supervisorPassword').value;
    const active = document.getElementById('supervisorActive').value === 'true';
    if (!empId) { alert('يرجى اختيار موظف'); showLoadingState(false); return; }
    if (!password) { document.getElementById('supervisorPasswordError').style.display = 'block'; showLoadingState(false); return; }
    document.getElementById('supervisorPasswordError').style.display = 'none';
    const emp = employeeDatabase.find(e => e.id === empId);
    if (!emp) { alert('الموظف غير موجود'); showLoadingState(false); return; }
    if (supervisors.some(s => s.employeeId === empId)) { alert('هذا الموظف مضاف بالفعل كمسؤول'); showLoadingState(false); return; }
    addData('supervisors', { employeeId: emp.id, employeeName: emp.name, employeePhone: emp.phone, password, active, createdAt: new Date().toISOString() })
        .then(() => { document.getElementById('supervisorForm').reset(); document.getElementById('supervisorActive').value = 'true'; showLoadingState(false); alert('تم إضافة المسؤول بنجاح'); loadAllData(); })
        .catch(() => { showLoadingState(false); alert('حدث خطأ'); });
}

function displaySupervisorsList() {
    const container = document.getElementById('supervisorsList'); container.innerHTML = '';
    if (supervisors.length === 0) { container.innerHTML = '<div class="empty-state">لا يوجد مسؤولين مسجلين</div>'; return; }
    supervisors.forEach(s => {
        const item = document.createElement('div'); item.className = 'list-item';
        item.innerHTML = `<div class="item-info"><div class="item-title">${s.employeeName}</div><div class="item-subtitle">${s.employeePhone}</div><div class="item-subtitle">كلمة السر: ${s.password}</div><div class="employee-status ${s.active ? 'status-active' : 'status-inactive'}">${s.active ? 'فعال' : 'غير فعال'}</div></div><div class="item-actions"><button class="btn-edit" onclick="editSupervisor('${s.id}')">تعديل</button><button class="btn-delete" onclick="deleteSupervisor('${s.id}')">حذف</button></div>`;
        container.appendChild(item);
    });
}

function editSupervisor(id) {
    const s = supervisors.find(x => x.id === id); if (!s) return;
    document.getElementById('supervisorEmployee').value = s.employeeId;
    document.getElementById('supervisorPassword').value = s.password;
    document.getElementById('supervisorActive').value = s.active.toString();
    deleteData('supervisors', id).then(() => { alert('يمكنك الآن تعديل بيانات المسؤول'); showPage('supervisors'); loadAllData(); });
}

function deleteSupervisor(id) { if (!confirm('هل أنت متأكد؟')) return; deleteData('supervisors', id).then(() => { alert('تم الحذف'); loadAllData(); }); }

// ======================== FAULTS ========================
function addFault() {
    showLoadingState(true);
    const station = document.getElementById('faultStation').value;
    const supId = document.getElementById('faultSupervisor').value;
    const title = document.getElementById('faultTitle').value;
    const desc = document.getElementById('faultDescription').value;
    const date = document.getElementById('faultDate').value;
    const status = document.getElementById('faultStatus').value;
    if (!station || !supId || !title || !desc || !date || !status) { alert('يرجى ملء جميع الحقول'); showLoadingState(false); return; }
    const sup = supervisors.find(s => s.id === supId);
    addData('faults', { stationName: station, supervisorId: supId, supervisorName: sup ? sup.employeeName : 'غير معروف', title, description: desc, date, status, createdAt: new Date().toISOString(), time: new Date().toLocaleTimeString('ar-EG', { hour12: false }) })
        .then(() => { document.getElementById('faultForm').reset(); document.getElementById('faultDate').value = new Date().toISOString().split('T')[0]; showLoadingState(false); alert('تم تسجيل العطل بنجاح'); loadAllData(); })
        .catch(() => { showLoadingState(false); alert('حدث خطأ'); });
}

function displayFaultsList() {
    const container = document.getElementById('faultsList'); container.innerHTML = '';
    const station = document.getElementById('filterFaultStation').value;
    const status = document.getElementById('filterFaultStatus').value;
    const start = document.getElementById('filterFaultStartDate').value;
    const end = document.getElementById('filterFaultEndDate').value;
    let filtered = faults;
    if (station) filtered = filtered.filter(f => f.stationName === station);
    if (status) filtered = filtered.filter(f => f.status === status);
    if (start && end) filtered = filtered.filter(f => f.date >= start && f.date <= end);
    if (filtered.length === 0) { container.innerHTML = '<div class="empty-state">لا توجد أعطال مسجلة</div>'; return; }
    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
    filtered.forEach(f => {
        const statusMap = { fixed: ['fault-fixed', 'تم الإصلاح'], 'in-progress': ['fault-in-progress', 'جاري الإصلاح'], pending: ['fault-pending', 'لم يتم الإصلاح'] };
        const [cls, txt] = statusMap[f.status] || ['fault-pending', 'لم يتم الإصلاح'];
        const item = document.createElement('div'); item.className = 'list-item';
        item.innerHTML = `<div class="item-info"><div class="item-title">${f.title}</div><div class="item-subtitle"><span class="station-badge">${f.stationName}</span><span class="${cls}">${txt}</span></div><div class="item-subtitle"><span>المسؤول: ${f.supervisorName}</span><span>التاريخ: ${f.date}</span><span class="time-badge">${f.time || ''}</span></div><div class="item-subtitle">${f.description}</div></div><div class="item-actions"><button class="btn-edit" onclick="editFault('${f.id}')">تعديل</button><button class="btn-delete" onclick="deleteFault('${f.id}')">حذف</button></div>`;
        container.appendChild(item);
    });
}

function editFault(id) {
    const f = faults.find(x => x.id === id); if (!f) return;
    document.getElementById('faultStation').value = f.stationName; document.getElementById('faultSupervisor').value = f.supervisorId;
    document.getElementById('faultTitle').value = f.title; document.getElementById('faultDescription').value = f.description;
    document.getElementById('faultDate').value = f.date; document.getElementById('faultStatus').value = f.status;
    deleteData('faults', id).then(() => { alert('يمكنك الآن تعديل العطل'); showPage('faults'); loadAllData(); });
}

function deleteFault(id) { if (!confirm('هل أنت متأكد؟')) return; deleteData('faults', id).then(() => { alert('تم الحذف'); loadAllData(); }); }

// ======================== REPORTS ========================
function getEmployeeStation(empName, month) {
    const recs = attendance.filter(r => r.employeeName === empName && r.date.startsWith(month) && r.stationName);
    if (!recs.length) return 'غير محدد';
    const counts = {};
    recs.forEach(r => { counts[r.stationName] = (counts[r.stationName] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function generateSalaryReport() {
    showLoadingState(true);
    const tbody = document.querySelector('#salaryReportTable tbody');
    tbody.innerHTML = '';
    const month = document.getElementById('reportMonth').value;
    const stFilter = document.getElementById('reportStationFilter').value;
    const empFilter = document.getElementById('reportEmployeeFilter').value;
    if (!month) { alert('يرجى اختيار شهر'); showLoadingState(false); return; }
    let filtered = employees.filter(e => e.active);
    if (empFilter) filtered = filtered.filter(e => e.name === empFilter);
    if (!filtered.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;">لا توجد بيانات</td></tr>'; document.getElementById('reportSummary').style.display = 'none'; showLoadingState(false); return; }
    let total = 0, totalDays = 0, count = 0;
    filtered.forEach(emp => {
        const data = calculateNetSalary(emp, month);
        const station = getEmployeeStation(emp.name, month);
        if (stFilter && station !== stFilter) return;
        total += data.netSalary; totalDays += data.workDays; count++;
        const row = document.createElement('tr');
        row.innerHTML = `<td>${emp.name}</td><td>${emp.job}</td><td><span class="station-badge">${station}</span></td><td>${emp.salary} ج.م</td><td>${data.workDays} يوم</td><td>${data.netSalary} ج.م</td><td><button class="btn-success" onclick="showSalaryDetails('${emp.name}','${month}')" style="padding:5px 10px;font-size:0.75rem;">تفاصيل</button><button class="btn-whatsapp" onclick="sendWhatsAppMessage('${emp.name}','${month}')" style="margin-top:5px;padding:5px 10px;font-size:0.75rem;"><i class="fab fa-whatsapp"></i></button></td>`;
        tbody.appendChild(row);
    });
    const summary = document.getElementById('reportSummary');
    if (count > 0) {
        summary.style.display = 'block';
        document.getElementById('reportSummaryContent').innerHTML = `<div class="filter-row"><div class="report-info-item"><span class="report-info-label">إجمالي الموظفين</span><span class="report-info-value">${count}</span></div><div class="report-info-item"><span class="report-info-label">إجمالي أيام الحضور</span><span class="report-info-value">${totalDays} يوم</span></div><div class="report-info-item"><span class="report-info-label">إجمالي المرتبات</span><span class="report-info-value">${Math.round(total)} ج.م</span></div></div>`;
    } else { summary.style.display = 'none'; tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;">لا توجد بيانات تطابق الفلترة</td></tr>'; }
    showLoadingState(false);
}

function showSalaryDetails(name, month) {
    const emp = employees.find(e => e.name === name); if (!emp) return;
    const d = calculateNetSalary(emp, month);
    alert(`تفاصيل راتب ${emp.name} (${emp.job}) لشهر ${month}\n- الراتب الأساسي: ${emp.salary} ج.م\n- أيام العمل المتفق عليها: ${emp.workDays} يوم\n- أيام الحضور الفعلية: ${d.workDays} يوم\n- سعر اليوم: ${d.dailyRate.toFixed(2)} ج.م\n${d.extraDays > 0 ? `- الأيام الإضافية: ${d.extraDays} يوم\n- قيمة الإضافي: ${d.extraSalary.toFixed(2)} ج.م\n` : ''}- السلف: ${d.loans} ج.م\n- المكافآت: ${d.rewards} ج.م\n- الخصومات: ${d.deductions} ج.م\n- صافي الراتب: ${d.netSalary} ج.م`);
}

function sendWhatsAppMessage(name, month) {
    const emp = employees.find(e => e.name === name); if (!emp) return;
    const d = calculateNetSalary(emp, month);
    const msg = `مرحباً ${emp.name} (${emp.job}),\n\nتفاصيل راتبك لشهر ${month}:\n- الراتب الأساسي: ${emp.salary} ج.م\n- أيام الحضور: ${d.workDays} يوم\n${d.extraDays > 0 ? `- أيام إضافية: ${d.extraDays} يوم (${d.extraSalary.toFixed(2)} ج.م)\n` : ''}- السلف: ${d.loans} ج.م\n- المكافآت: ${d.rewards} ج.م\n- الخصومات: ${d.deductions} ج.م\n- صافي الراتب: ${d.netSalary} ج.م\n\nشكراً لجهودك!`;
    window.open(`https://wa.me/${emp.whatsapp || emp.phone}?text=${encodeURIComponent(msg)}`, '_blank');
}

function generateEmployeeReport() {
    const empName = document.getElementById('selectEmployeeForReport').value;
    const month = document.getElementById('selectMonthForReport').value;
    if (!empName || !month) { alert('يرجى اختيار الموظف والشهر'); return; }
    const emp = employees.find(e => e.name === empName && e.active);
    if (!emp) { alert('الموظف غير موجود أو غير فعال'); return; }
    const data = calculateNetSalary(emp, month);
    const monthAtt = attendance.filter(r => r.employeeName === empName && r.date.startsWith(month)).sort((a, b) => new Date(a.date) - new Date(b.date));
    const monthLeaves = leaves.filter(l => l.employeeName === empName && l.start.startsWith(month));
    const reportData = { employeeName: emp.name, employeeJob: emp.job, month, attendance: monthAtt, leaves: monthLeaves, summary: { ...data, totalAbsent: monthAtt.filter(a => a.status === 'غائب').length, totalLeaves: monthAtt.filter(a => a.status === 'إجازة').length } };
    currentReportData = { ...reportData, emp };
    displayEnhancedEmployeeReport(reportData, emp, month);
}

function displayEnhancedEmployeeReport(reportData, emp, month) {
    const container = document.getElementById('employeeReportContainer');
    container.innerHTML = `<div class="employee-report-card"><div class="employee-report-header"><i class="fas fa-user"></i> تقرير ${emp.name} (${emp.job}) - ${month}</div><div class="employee-report-body"><div class="report-info-grid"><div class="report-info-item"><span class="report-info-label">الوظيفة</span><span class="report-info-value">${emp.job}</span></div><div class="report-info-item"><span class="report-info-label">الراتب الأساسي</span><span class="report-info-value">${emp.salary} ج.م</span></div><div class="report-info-item"><span class="report-info-label">أيام العمل المتفق عليها</span><span class="report-info-value">${emp.workDays} يوم</span></div><div class="report-info-item"><span class="report-info-label">رقم الهاتف</span><span class="report-info-value">${emp.phone}</span></div></div><div class="attendance-stats"><div class="attendance-stat present"><div class="attendance-stat-value">${reportData.summary.workDays}</div><div class="attendance-stat-label">أيام الحضور</div></div><div class="attendance-stat absent"><div class="attendance-stat-value">${reportData.summary.totalAbsent}</div><div class="attendance-stat-label">أيام الغياب</div></div><div class="attendance-stat leave"><div class="attendance-stat-value">${reportData.summary.totalLeaves}</div><div class="attendance-stat-label">أيام الإجازة</div></div></div><div class="daily-report-table"><h4 style="padding:15px;margin:0;background:var(--bg-filter);border-bottom:2px solid var(--primary);color:var(--text-heading);"><i class="fas fa-calendar-alt"></i> التفاصيل اليومية</h4><div class="table-container"><table class="enhanced-table"><thead><tr><th>اليوم</th><th>التاريخ</th><th>المحطة</th><th>المسؤول</th><th>الحالة</th><th>وقت التسجيل</th><th>ملاحظات</th></tr></thead><tbody id="enhancedDailyDetailsBody"></tbody></table></div></div><div class="salary-summary"><h4><i class="fas fa-chart-pie"></i> ملخص الراتب الشهري</h4><div class="salary-breakdown"><div class="breakdown-item"><div class="breakdown-label">الراتب الأساسي المستحق</div><div class="breakdown-value">${reportData.summary.baseSalary.toFixed(2)} ج.م</div></div>${reportData.summary.extraDays > 0 ? `<div class="breakdown-item"><div class="breakdown-label">الأيام الإضافية (${reportData.summary.extraDays} يوم)</div><div class="breakdown-value positive">+ ${reportData.summary.extraSalary.toFixed(2)} ج.م</div></div>` : ''}<div class="breakdown-item"><div class="breakdown-label">المكافآت</div><div class="breakdown-value positive">+ ${reportData.summary.rewards} ج.م</div></div><div class="breakdown-item"><div class="breakdown-label">السلف</div><div class="breakdown-value negative">- ${reportData.summary.loans} ج.م</div></div><div class="breakdown-item"><div class="breakdown-label">الخصومات</div><div class="breakdown-value negative">- ${reportData.summary.deductions} ج.م</div></div></div>${reportData.summary.isFebruary && reportData.summary.workDays < emp.workDays ? `<div class="alert alert-info"><i class="fas fa-info-circle"></i> ملاحظة: شهر فبراير، تم احتساب الراتب كاملاً رغم قلة أيام الحضور.</div>` : ''}<div class="net-salary"><h3>صافي الراتب: ${reportData.summary.netSalary} ج.م</h3></div></div><div style="display:flex;gap:10px;margin-top:20px;"><button class="btn-success" onclick="exportEmployeeReportToExcel()" style="flex:1;"><i class="fas fa-download"></i> تصدير</button><button class="btn-whatsapp" onclick="sendEmployeeReportWhatsApp()" style="flex:1;"><i class="fab fa-whatsapp"></i> واتساب</button></div></div></div>`;
    const tbody = document.getElementById('enhancedDailyDetailsBody');
    const [year, monthNum] = month.split('-').map(Number);
    const daysInMonth = new Date(year, monthNum, 0).getDate();
    const arabicDays = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${monthNum.toString().padStart(2,'0')}-${day.toString().padStart(2,'0')}`;
        const dayName = arabicDays[new Date(dateStr).getDay()];
        const rec = reportData.attendance.find(a => a.date === dateStr);
        let status = 'لم يتم التسجيل', statusCls = '', station = '', supName = '', notes = '', timeInfo = '';
        if (rec) {
            status = rec.status; station = rec.stationName || 'غير محدد';
            statusCls = rec.status === 'حاضر' ? 'status-present' : rec.status === 'غائب' ? 'status-absent' : 'status-leave';
            const sup = supervisors.find(s => s.id === rec.supervisorId);
            supName = sup ? sup.employeeName : (rec.supervisorName || 'غير محدد');
            timeInfo = rec.time ? `<span class="time-badge">${rec.time}</span>` : '';
            const leaveRec = reportData.leaves.find(l => { const s = new Date(l.start), e = new Date(l.end), c = new Date(dateStr); return c >= s && c <= e; });
            if (leaveRec) { notes = `إجازة: ${leaveRec.type}`; if (leaveRec.notes) notes += ` - ${leaveRec.notes}`; }
        }
        const row = document.createElement('tr');
        row.innerHTML = `<td class="day-name">${dayName}</td><td>${dateStr}</td><td>${station}</td><td>${supName}</td><td><span class="status-badge ${statusCls}">${status}</span></td><td>${timeInfo}</td><td>${notes}</td>`;
        tbody.appendChild(row);
    }
    container.style.display = 'block'; container.scrollIntoView({ behavior: 'smooth' });
}

function exportEmployeeReportToExcel() {
    if (!currentReportData) { alert('لا توجد بيانات. يرجى إنشاء التقرير أولاً.'); return; }
    const { emp, employeeName, employeeJob, month, attendance: att, leaves: lv, summary } = currentReportData;
    const rows = [['تقرير الموظف الشهري'], [`الموظف: ${employeeName} (${employeeJob})`], [`الشهر: ${month}`], [], ['الراتب الأساسي', `${summary.baseSalary.toFixed(2)} ج.م`], ['أيام الحضور', `${summary.workDays} يوم`], ['المكافآت', `${summary.rewards} ج.م`], ['السلف', `${summary.loans} ج.م`], ['الخصومات', `${summary.deductions} ج.م`], ['صافي الراتب', `${summary.netSalary} ج.م`], [], ['اليوم','التاريخ','المحطة','المسؤول','الحالة','وقت التسجيل','ملاحظات']];
    const [year, monthNum] = month.split('-').map(Number);
    const days = new Date(year, monthNum, 0).getDate();
    const arabicDays = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
    for (let d = 1; d <= days; d++) {
        const dateStr = `${year}-${monthNum.toString().padStart(2,'0')}-${d.toString().padStart(2,'0')}`;
        const rec = att.find(a => a.date === dateStr);
        rows.push([arabicDays[new Date(dateStr).getDay()], dateStr, rec?.stationName || '', rec ? (supervisors.find(s => s.id === rec.supervisorId)?.employeeName || rec.supervisorName || '') : '', rec?.status || 'لم يتم التسجيل', rec?.time || '', '']);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'تقرير');
    XLSX.writeFile(wb, `تقرير_${employeeName}_${month}.xlsx`);
}

function sendEmployeeReportWhatsApp() {
    if (!currentReportData) { alert('لا توجد بيانات'); return; }
    const { emp, employeeName, month, summary } = currentReportData;
    const employee = employees.find(e => e.name === employeeName); if (!employee) return;
    const msg = `مرحباً ${employee.name} (${employee.job}),\n\nتفاصيل راتبك لشهر ${month}:\n- الراتب الأساسي: ${employee.salary} ج.م\n- أيام الحضور: ${summary.workDays} يوم\n${summary.extraDays > 0 ? `- أيام إضافية: ${summary.extraDays} يوم\n` : ''}- السلف: ${summary.loans} ج.م\n- المكافآت: ${summary.rewards} ج.م\n- الخصومات: ${summary.deductions} ج.م\n- صافي الراتب: ${summary.netSalary} ج.م\n\nشكراً لجهودك!`;
    window.open(`https://wa.me/${employee.whatsapp || employee.phone}?text=${encodeURIComponent(msg)}`, '_blank');
}

// ======================== IMPORT/EXPORT ========================
function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([['اسم الموظف','رقم الهاتف','رقم الواتساب','العنوان'],['أحمد محمد','01234567890','01234567890','القاهرة']]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'نموذج'); XLSX.writeFile(wb, 'نموذج_استيراد_الموظفين.xlsx');
}

function parseCSV(text) {
    return text.split('\n').filter(l => l.trim()).map(l => {
        const row = []; const re = /(?:,|\n|^)(?:"([^"]*(?:""[^"]*)*)"|([^",\n]*))/g; let m;
        while ((m = re.exec(l)) !== null) row.push((m[1] || m[2] || '').replace(/""/g, '"'));
        return row;
    });
}

function previewImport() {
    const file = document.getElementById('importFile').files[0]; if (!file) { alert('يرجى اختيار ملف'); return; }
    const reader = new FileReader();
    reader.onload = e => {
        try {
            let data;
            if (file.name.endsWith('.csv')) data = parseCSV(e.target.result);
            else { const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' }); data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }); }
            if (data.length <= 1) { alert('الملف لا يحتوي على بيانات'); return; }
            const tbody = document.querySelector('#previewTable tbody'); tbody.innerHTML = '';
            for (let i = 1; i < data.length; i++) {
                if (!data[i].length) continue;
                const tr = document.createElement('tr');
                for (let j = 0; j < 4; j++) { const td = document.createElement('td'); td.textContent = data[i][j] || ''; tr.appendChild(td); }
                tbody.appendChild(tr);
            }
            document.getElementById('importPreview').style.display = 'block';
        } catch { alert('خطأ في معاينة الملف'); }
    };
    if (file.name.endsWith('.csv')) reader.readAsText(file); else reader.readAsArrayBuffer(file);
}

function importEmployees() {
    const file = document.getElementById('importFile').files[0]; if (!file) { alert('يرجى اختيار ملف'); return; }
    const reader = new FileReader();
    reader.onload = e => {
        try {
            let data;
            if (file.name.endsWith('.csv')) data = parseCSV(e.target.result);
            else { const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' }); data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }); }
            const toAdd = [], errors = [];
            for (let i = 1; i < data.length; i++) {
                if (!data[i].length) continue;
                const name = (data[i][0] || '').toString().trim();
                const phone = (data[i][1] || '').toString().trim();
                if (!name || !phone) { errors.push(`الصف ${i+1}: الاسم ورقم الهاتف مطلوبان`); continue; }
                if (employeeDatabase.some(e => e.name === name || e.phone === phone)) { errors.push(`الصف ${i+1}: الموظف ${name} موجود مسبقاً`); continue; }
                toAdd.push({ name, phone, whatsapp: (data[i][2] || phone).toString().trim(), address: (data[i][3] || '').toString().trim(), active: false });
            }
            showLoadingState(true);
            Promise.allSettled(toAdd.map(emp => addData('employeeDatabase', emp))).then(results => {
                showLoadingState(false);
                const ok = results.filter(r => r.status === 'fulfilled').length;
                let msg = `<div class="import-success">تم إضافة ${ok} موظف بنجاح</div>`;
                if (errors.length) msg += `<div class="import-error"><ul>${errors.map(e => `<li>${e}</li>`).join('')}</ul></div>`;
                const statusDiv = document.getElementById('importStatus'); statusDiv.innerHTML = msg; statusDiv.style.display = 'block';
                document.getElementById('importFile').value = ''; document.getElementById('importPreview').style.display = 'none';
                loadAllData();
            });
        } catch { alert('خطأ في استيراد الملف'); }
    };
    if (file.name.endsWith('.csv')) reader.readAsText(file); else reader.readAsArrayBuffer(file);
}

function importFromDatabase() {
    const selected = Array.from(document.getElementById('selectMultipleEmployees').selectedOptions);
    if (!selected.length) { alert('يرجى اختيار موظفين'); return; }
    const job = document.getElementById('defaultJob').value;
    const salary = parseInt(document.getElementById('defaultSalary').value) || 0;
    const workDays = parseInt(document.getElementById('defaultWorkDays').value) || 24;
    if (!job) { alert('يرجى إدخال الوظيفة الافتراضية'); return; }
    if (salary <= 0) { alert('يرجى إدخال راتب صحيح'); return; }
    showLoadingState(true);
    const promises = selected.map(opt => {
        const emp = employeeDatabase.find(e => e.id === opt.value); if (!emp) return Promise.reject('الموظف غير موجود');
        if (employees.some(e => e.phone === emp.phone)) return Promise.reject(`${emp.name} مضاف بالفعل`);
        return addData('employees', { name: emp.name, phone: emp.phone, job, salary, workDays, active: true, attendanceDays: 0 }).then(() => updateData('employeeDatabase', emp.id, { active: true }));
    });
    Promise.allSettled(promises).then(results => {
        showLoadingState(false);
        const ok = results.filter(r => r.status === 'fulfilled').length;
        const fail = results.filter(r => r.status === 'rejected').length;
        let msg = `<div class="import-success">تم إضافة ${ok} موظف</div>`;
        if (fail) msg += `<div class="import-error">فشل ${fail}</div>`;
        const statusDiv = document.getElementById('importStatus'); statusDiv.innerHTML = msg; statusDiv.style.display = 'block';
        document.getElementById('defaultJob').value = ''; document.getElementById('defaultSalary').value = ''; document.getElementById('defaultWorkDays').value = '24';
        loadAllData();
    });
}

function importContacts() {
    if ('contacts' in navigator && 'select' in navigator.contacts) {
        navigator.contacts.select(['name', 'tel'], { multiple: true }).then(contacts => {
            if (!contacts.length) { alert('لم يتم اختيار جهات اتصال'); return; }
            const tbody = document.querySelector('#contactsPreviewTable tbody'); tbody.innerHTML = '';
            contacts.forEach(c => {
                const name = c.name ? c.name[0] : 'غير معروف';
                const phone = c.tel ? c.tel[0] : null; if (!phone) return;
                const isDup = employeeDatabase.some(e => e.name === name || e.phone === phone);
                const tr = document.createElement('tr');
                tr.innerHTML = `<td><input type="checkbox" class="contact-checkbox" ${isDup ? 'disabled' : 'checked'} data-name="${name}" data-phone="${phone}"></td><td>${name}</td><td>${phone}</td><td class="${isDup ? 'status-absent' : 'status-present'}">${isDup ? 'موجود مسبقاً' : 'جاهز للإضافة'}</td>`;
                tbody.appendChild(tr);
            });
            document.getElementById('contactsPreview').style.display = 'block';
        }).catch(() => alert('خطأ في استيراد جهات الاتصال'));
    } else alert('متصفحك لا يدعم هذه الميزة');
}

function selectAllContacts() { document.querySelectorAll('.contact-checkbox:not(:disabled)').forEach(cb => cb.checked = true); }
function deselectAllContacts() { document.querySelectorAll('.contact-checkbox:not(:disabled)').forEach(cb => cb.checked = false); }

function addSelectedContacts() {
    const selected = [];
    document.querySelectorAll('.contact-checkbox:checked:not(:disabled)').forEach(cb => selected.push({ name: cb.dataset.name, phone: cb.dataset.phone, whatsapp: cb.dataset.phone, address: '', active: false }));
    if (!selected.length) { alert('يرجى اختيار جهات اتصال'); return; }
    showLoadingState(true);
    Promise.all(selected.map(c => addData('employeeDatabase', c))).then(() => { showLoadingState(false); alert(`تم إضافة ${selected.length} جهة اتصال`); document.getElementById('contactsPreview').style.display = 'none'; loadAllData(); }).catch(() => { showLoadingState(false); alert('حدث خطأ'); });
}

// ======================== BACKUP ========================
function downloadBackup() {
    const data = JSON.stringify({ employees, attendance, leaves, financials, employeeDatabase, cashTransactions, stations, supervisors, faults, loans, backupDate: new Date().toISOString() }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    alert('تم تحميل النسخة الاحتياطية بنجاح');
}

function restoreBackup() {
    const file = document.getElementById('backupFile').files[0]; if (!file) { alert('يرجى اختيار ملف'); return; }
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.employees || !data.attendance) { alert('ملف غير صالح'); return; }
            if (!confirm('هل أنت متأكد من استعادة النسخة الاحتياطية؟ سيتم استبدال جميع البيانات الحالية.')) return;
            showLoadingState(true);
            Promise.all([saveData('employees', data.employees), saveData('attendance', data.attendance), saveData('leaves', data.leaves || []), saveData('financials', data.financials || []), saveData('employeeDatabase', data.employeeDatabase || []), saveData('cashTransactions', data.cashTransactions || []), saveData('stations', data.stations || []), saveData('supervisors', data.supervisors || []), saveData('faults', data.faults || []), saveData('loans', data.loans || [])])
                .then(() => { showLoadingState(false); alert('تم استعادة النسخة الاحتياطية بنجاح'); showPage('dashboard'); loadAllData(); })
                .catch(() => { showLoadingState(false); alert('حدث خطأ أثناء الاستعادة'); });
        } catch { alert('ملف غير صالح'); }
    };
    reader.readAsText(file);
}

function deleteAllData() {
    if (!confirm('هل أنت متأكد من حذف جميع البيانات؟ لا يمكن التراجع عن هذا الإجراء.')) return;
    showLoadingState(true);
    Promise.all(['employees','attendance','leaves','financials','employeeDatabase','cashTransactions','stations','supervisors','faults','loans'].map(t => saveData(t, [])))
        .then(() => { showLoadingState(false); alert('تم حذف جميع البيانات'); showPage('dashboard'); loadAllData(); })
        .catch(() => { showLoadingState(false); alert('حدث خطأ'); });
}

function deleteSelectiveData() {
    const type = document.getElementById('selectiveDataType').value;
    const start = document.getElementById('selectiveStartDate').value;
    const end = document.getElementById('selectiveEndDate').value;
    if (!start || !end) { alert('يرجى تحديد التواريخ'); return; }
    const arrays = { attendance, financials, loans, cashTransactions, faults };
    const names = { attendance: 'سجلات الحضور', financials: 'الحركات المالية', loans: 'طلبات السلف', cashTransactions: 'حركات العهدة', faults: 'سجل الأعطال' };
    const toDelete = arrays[type].filter(r => r.date >= start && r.date <= end);
    if (!toDelete.length) { alert(`لا توجد ${names[type]} في الفترة المحددة`); return; }
    if (!confirm(`هل أنت متأكد من حذف ${toDelete.length} سجل من ${names[type]}؟`)) return;
    showLoadingState(true);
    Promise.all(toDelete.map(r => deleteData(type, r.id))).then(() => { showLoadingState(false); alert(`تم حذف ${toDelete.length} سجل`); loadAllData(); }).catch(() => { showLoadingState(false); alert('حدث خطأ'); });
}

// ======================== EXCEL EXPORT ========================
function exportToExcel(data, name) {
    try {
        if (Array.isArray(data)) {
            const ws = XLSX.utils.json_to_sheet(data);
            const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
            XLSX.writeFile(wb, `${name}.xlsx`);
        } else {
            const wb = XLSX.utils.book_new();
            for (const [s, d] of Object.entries(data)) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d), s);
            XLSX.writeFile(wb, `${name}.xlsx`);
        }
        alert(`تم تصدير ${name} بنجاح`);
    } catch { alert('حدث خطأ أثناء التصدير'); }
}

function exportAllData() { exportToExcel({ الموظفون: employees, الحضور: attendance, الحركات_المالية: financials, طلبات_السلف: loans, حركات_العهدة: cashTransactions, المحطات: stations, المسؤولون: supervisors, الأعطال: faults }, 'جميع_البيانات'); }
function exportEmployeesToExcel() { exportToExcel(employees.map(e => ({ 'اسم الموظف': e.name, 'الوظيفة': e.job, 'رقم الهاتف': e.phone, 'الراتب': e.salary, 'أيام العمل': e.workDays, 'الحالة': e.active ? 'فعال' : 'غير فعال' })), 'بيانات_الموظفين'); }
function exportEmployeeDatabaseToExcel() { exportToExcel(employeeDatabase.map(e => ({ 'اسم الموظف': e.name, 'رقم الهاتف': e.phone, 'رقم الواتساب': e.whatsapp || e.phone, 'العنوان': e.address || '', 'الحالة': e.active ? 'مفعل' : 'غير مفعل' })), 'قاعدة_بيانات_الموظفين'); }
function exportAttendanceToExcel() {
    const month = document.getElementById('filterAttendanceMonth').value;
    const station = document.getElementById('filterAttendanceStation').value;
    let filtered = attendance.filter(r => r.date.startsWith(month));
    if (station) filtered = filtered.filter(r => r.stationName === station);
    exportToExcel(filtered.map(r => ({ 'اسم الموظف': r.employeeName, 'المحطة': r.stationName, 'المسؤول': supervisors.find(s => s.id === r.supervisorId)?.employeeName || r.supervisorName, 'التاريخ': r.date, 'الوقت': r.time || '', 'الحالة': r.status })), 'سجل_الحضور');
}
function exportFinancialsToExcel() {
    const month = document.getElementById('filterFinancialMonth')?.value || '';
    let filtered = financials;
    if (month) filtered = filtered.filter(f => f.date.startsWith(month));
    exportToExcel(filtered.map(f => ({ 'الموظف': f.employeeName, 'المحطة': f.stationName, 'النوع': f.type, 'المبلغ': f.amount, 'التاريخ': f.date, 'ملاحظات': f.notes })), 'الحركات_المالية');
}
function exportReportToExcel() {
    const month = document.getElementById('reportMonth').value;
    const stFilter = document.getElementById('reportStationFilter').value;
    let filtered = employees.filter(e => e.active);
    exportToExcel(filtered.map(emp => {
        const data = calculateNetSalary(emp, month);
        const station = getEmployeeStation(emp.name, month);
        if (stFilter && station !== stFilter) return null;
        return { 'اسم الموظف': emp.name, 'الوظيفة': emp.job, 'المحطة': station, 'الراتب الأساسي': emp.salary, 'أيام الحضور': data.workDays, 'صافي الراتب': data.netSalary };
    }).filter(Boolean), 'تقرير_المرتبات');
}
function exportCashToExcel() {
    exportToExcel(cashTransactions.map(t => ({ 'التاريخ': t.date, 'النوع': t.type, 'المبلغ': t.amount, 'السبب': t.reason, 'المسؤول': supervisors.find(s => s.id === t.supervisorId)?.employeeName || t.supervisorName, 'المحطة': t.stationName })), 'حركات_العهدة');
}
function exportFaultsToExcel() {
    exportToExcel(faults.map(f => ({ 'المحطة': f.stationName, 'العنوان': f.title, 'التفاصيل': f.description, 'التاريخ': f.date, 'الحالة': f.status === 'fixed' ? 'تم الإصلاح' : f.status === 'in-progress' ? 'جاري الإصلاح' : 'لم يتم الإصلاح' })), 'سجل_الأعطال');
}
function exportStationsToExcel() { exportToExcel(stations.map(s => ({ 'الاسم': s.name, 'النوع': s.type, 'المحافظة': s.governorate, 'المنطقة': s.area, 'العنوان': s.address })), 'قائمة_المحطات'); }
function exportSupervisorsToExcel() { exportToExcel(supervisors.map(s => ({ 'الاسم': s.employeeName, 'الهاتف': s.employeePhone, 'كلمة السر': s.password, 'الحالة': s.active ? 'فعال' : 'غير فعال' })), 'قائمة_المسؤولين'); }

function validateAmount(amount, errorId) {
    const el = document.getElementById(errorId);
    if (!amount || amount <= 0) { el.style.display = 'block'; return false; }
    el.style.display = 'none'; return true;
}

// ======================== EVENT SETUP ========================
function setupEventListeners() {
    menuBtn.addEventListener('click', toggleSideMenu);
    closeMenuBtn.addEventListener('click', toggleSideMenu);
    overlay.addEventListener('click', toggleSideMenu);
    exportBtn.addEventListener('click', exportAllData);
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);

    document.getElementById('exportEmployees').addEventListener('click', exportEmployeesToExcel);
    document.getElementById('exportEmployeeDatabase').addEventListener('click', exportEmployeeDatabaseToExcel);
    document.getElementById('exportAttendance').addEventListener('click', exportAttendanceToExcel);
    document.getElementById('exportFinancials').addEventListener('click', exportFinancialsToExcel);
    document.getElementById('exportReport').addEventListener('click', exportReportToExcel);
    document.getElementById('exportCashTransactions').addEventListener('click', exportCashToExcel);
    document.getElementById('exportFaults').addEventListener('click', exportFaultsToExcel);
    document.getElementById('exportStations').addEventListener('click', exportStationsToExcel);
    document.getElementById('exportSupervisors').addEventListener('click', exportSupervisorsToExcel);

    document.querySelectorAll('.nav-item, .nav-item-attendance, .quick-action, .see-all, .menu-link').forEach(el => {
        el.addEventListener('click', function(e) {
            e.preventDefault();
            const target = this.getAttribute('data-target');
            if (!target) return;
            showPage(target);
            if (this.classList.contains('nav-item') || this.classList.contains('nav-item-attendance')) {
                document.querySelectorAll('.nav-item, .nav-item-attendance').forEach(n => n.classList.remove('active'));
                this.classList.add('active');
            }
            if (this.classList.contains('menu-link')) {
                document.querySelectorAll('.menu-link').forEach(l => l.classList.remove('active'));
                this.classList.add('active');
                toggleSideMenu(); updateBottomNavFromSidebar(target);
            }
        });
    });

    document.getElementById('showAddForm').addEventListener('click', function() {
        const form = document.getElementById('employeeForm');
        const msg = document.getElementById('employeeFormMessage');
        const hidden = form.classList.contains('hidden');
        form.classList.toggle('hidden'); msg.style.display = hidden ? 'none' : 'block';
        this.textContent = hidden ? 'إخفاء النموذج' : 'إظهار النموذج';
    });

    document.getElementById('employeeForm').addEventListener('submit', e => { e.preventDefault(); addEmployee(); });
    document.getElementById('employeeDatabaseForm').addEventListener('submit', e => { e.preventDefault(); addEmployeeToDatabase(); });
    document.getElementById('manualAttendanceForm').addEventListener('submit', e => { e.preventDefault(); recordManualAttendance(); });
    document.getElementById('financialForm').addEventListener('submit', e => { e.preventDefault(); addFinancial(); });
    document.getElementById('faultForm').addEventListener('submit', e => { e.preventDefault(); addFault(); });
    document.getElementById('stationForm').addEventListener('submit', e => { e.preventDefault(); addStation(); });
    document.getElementById('supervisorForm').addEventListener('submit', e => { e.preventDefault(); addSupervisor(); });
    document.getElementById('cashDepositForm').addEventListener('submit', e => { e.preventDefault(); addCashDeposit(); });
    document.getElementById('cashWithdrawalForm').addEventListener('submit', e => { e.preventDefault(); addCashWithdrawal(); });

    document.getElementById('generateReport').addEventListener('click', generateSalaryReport);
    document.getElementById('generateEmployeeReportBtn').addEventListener('click', generateEmployeeReport);
    document.getElementById('applyAttendanceFilter').addEventListener('click', displayAttendanceList);
    document.getElementById('applyFinancialFilter').addEventListener('click', displayFinancialsList);
    document.getElementById('applyFaultFilter').addEventListener('click', displayFaultsList);
    document.getElementById('resetFaultFilter').addEventListener('click', () => {
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('filterFaultStartDate').value = today;
        document.getElementById('filterFaultEndDate').value = today;
        document.getElementById('filterFaultStation').value = '';
        document.getElementById('filterFaultStatus').value = '';
        displayFaultsList();
    });
    document.getElementById('filterCashBtn').addEventListener('click', displayCashTransactions);
    document.getElementById('filterCashType').addEventListener('change', displayCashTransactions);
    document.getElementById('filterCashSupervisor').addEventListener('change', displayCashTransactions);
    document.querySelectorAll('.cash-tab[data-tab]').forEach(tab => {
        tab.addEventListener('click', function() {
            const id = this.getAttribute('data-tab');
            document.querySelectorAll('.cash-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.cash-tab-content').forEach(c => c.classList.remove('active'));
            this.classList.add('active'); document.getElementById(id).classList.add('active');
        });
    });
    document.getElementById('searchEmployee').addEventListener('input', displayEmployeeDatabase);
    document.getElementById('dashboardStationFilter').addEventListener('change', updateDashboard);
    document.getElementById('autoAttendanceBtn').addEventListener('click', recordAutoAttendance);
    document.getElementById('downloadTemplateBtn').addEventListener('click', downloadTemplate);
    document.getElementById('previewImportBtn').addEventListener('click', previewImport);
    document.getElementById('importEmployeesBtn').addEventListener('click', importEmployees);
    document.getElementById('importFromDatabaseBtn').addEventListener('click', importFromDatabase);
    document.getElementById('importContactsBtn').addEventListener('click', importContacts);
    document.getElementById('selectAllContacts').addEventListener('click', selectAllContacts);
    document.getElementById('deselectAllContacts').addEventListener('click', deselectAllContacts);
    document.getElementById('addSelectedContactsBtn').addEventListener('click', addSelectedContacts);
    document.getElementById('downloadBackupBtn').addEventListener('click', downloadBackup);
    document.getElementById('restoreBackupBtn').addEventListener('click', restoreBackup);
    document.getElementById('deleteAllDataBtn').addEventListener('click', deleteAllData);
    document.getElementById('deleteSelectiveDataBtn').addEventListener('click', deleteSelectiveData);
    document.getElementById('logoutBtn').addEventListener('click', e => { e.preventDefault(); if (confirm('هل تريد تسجيل الخروج؟')) alert('تم تسجيل الخروج بنجاح'); });
    document.getElementById('generatePasswordBtn').addEventListener('click', () => { document.getElementById('supervisorPassword').value = generateRandomPassword(); });
    document.getElementById('filterLoanStartDate').addEventListener('change', applyLoanFilters);
    document.getElementById('filterLoanEndDate').addEventListener('change', applyLoanFilters);
    document.getElementById('filterLoanStation').addEventListener('change', applyLoanFilters);
    document.getElementById('filterLoanSupervisor').addEventListener('change', applyLoanFilters);
    const quickSearch = document.getElementById('quickSearchEmployee');
    if (quickSearch) quickSearch.addEventListener('input', function() { clearTimeout(quickSearchTimeout); quickSearchTimeout = setTimeout(() => displayEmployeesList(this.value), 300); });
    document.getElementById('cashDepositAmount').addEventListener('blur', e => validateAmount(e.target.value, 'cashDepositAmountError'));
    document.getElementById('cashWithdrawalAmount').addEventListener('blur', e => validateAmount(e.target.value, 'cashWithdrawalAmountError'));
}

// ======================== GLOBAL EXPORTS ========================
window.openEditEmployeeModal = openEditEmployeeModal;
window.closeEditModal = closeEditModal;
window.saveEmployeeEdit = saveEmployeeEdit;
window.editFinancial = editFinancial;
window.deleteFinancial = deleteFinancial;
window.toggleEmployeeStatus = toggleEmployeeStatus;
window.callEmployee = callEmployee;
window.sendWhatsAppToEmployee = sendWhatsAppToEmployee;
window.activateEmployeeFromDatabase = activateEmployeeFromDatabase;
window.editEmployeeInDatabase = editEmployeeInDatabase;
window.deleteEmployeeFromDatabase = deleteEmployeeFromDatabase;
window.deleteEmployee = deleteEmployee;
window.showSalaryDetails = showSalaryDetails;
window.sendWhatsAppMessage = sendWhatsAppMessage;
window.exportEmployeeReportToExcel = exportEmployeeReportToExcel;
window.sendEmployeeReportWhatsApp = sendEmployeeReportWhatsApp;
window.editStation = editStation;
window.deleteStation = deleteStation;
window.editSupervisor = editSupervisor;
window.deleteSupervisor = deleteSupervisor;
window.editFault = editFault;
window.deleteFault = deleteFault;
window.showEmployeeHistory = showEmployeeHistory;
window.filterLoans = filterLoans;
window.applyLoanFilters = applyLoanFilters;
window.resetLoanFilters = resetLoanFilters;
window.openLoanModal = openLoanModal;
window.closeLoanModal = closeLoanModal;
window.updateLoanStatus = updateLoanStatus;
window.sendLoanWhatsApp = sendLoanWhatsApp;

// ======================== INIT ========================
document.addEventListener('DOMContentLoaded', function() {
    initTheme();
    const today = new Date().toISOString().split('T')[0];
    const currentMonth = new Date().toISOString().slice(0, 7);
    ['attendanceDate','financialDate','faultDate','cashDepositDate','cashWithdrawalDate','filterCashDate','selectiveEndDate'].forEach(id => { const el = document.getElementById(id); if (el) el.value = today; });
    ['selectMonthForReport','filterAttendanceMonth','reportMonth','filterFinancialMonth'].forEach(id => { const el = document.getElementById(id); if (el) el.value = currentMonth; });
    document.getElementById('filterFaultStartDate').value = today;
    document.getElementById('filterFaultEndDate').value = today;
    const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
    document.getElementById('selectiveStartDate').value = firstDay;
    document.getElementById('filterLoanStartDate').value = firstDay;
    document.getElementById('filterLoanEndDate').value = today;
    document.getElementById('employeeForm').classList.add('hidden');
    document.getElementById('employeeFormMessage').style.display = 'block';
    setupEventListeners();
    monitorConnection();
    loadAllData();
});
