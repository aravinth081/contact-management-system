/* ==========================================================================
   GLOBAL UTILITIES & TOAST ENGINE
   ========================================================================== */
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let iconName = 'check-circle';
    if (type === 'error') iconName = 'alert-circle';
    if (type === 'warning') iconName = 'alert-triangle';
    if (type === 'info') iconName = 'info';

    toast.innerHTML = `
        <div class="toast-icon">
            <i data-lucide="${iconName}"></i>
        </div>
        <div class="toast-message">${message}</div>
    `;

    container.appendChild(toast);
    lucide.createIcons();

    // Auto remove toast
    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Global Loader helper
function toggleLoader(btnId, isLoading, defaultText = "Save") {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    if (isLoading) {
        btn.disabled = true;
        btn.dataset.originalHtml = btn.innerHTML;
        btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin" style="width: 14px; height: 14px;"></i> <span>Loading...</span>`;
        lucide.createIcons();
    } else {
        btn.disabled = false;
        btn.innerHTML = btn.dataset.originalHtml || defaultText;
    }
}

/* ==========================================================================
   THEME TOGGLING & RESPONSIVE MENU
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    // 1. Theme Toggler
    const themeToggleBtn = document.getElementById('themeToggleBtn');
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
            const newTheme = currentTheme === 'light' ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            
            // Re-render dashboard charts if page is dashboard
            if (window.activePage === 'dashboard') {
                renderDashboardCharts();
            }
        });
    }

    // 2. Mobile Responsive Sidebar Menu Toggle
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const mobileCloseBtn = document.getElementById('mobileCloseBtn');
    const sidebar = document.getElementById('sidebar');

    if (mobileMenuBtn && sidebar) {
        mobileMenuBtn.addEventListener('click', () => sidebar.classList.add('active'));
    }
    if (mobileCloseBtn && sidebar) {
        mobileCloseBtn.addEventListener('click', () => sidebar.classList.remove('active'));
    }

    // Close sidebar on overlay clicking
    document.addEventListener('click', (e) => {
        if (sidebar && sidebar.classList.contains('active')) {
            if (!sidebar.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
                sidebar.classList.remove('active');
            }
        }
    });

    // 3. Notification Dropdown Toggle
    const notificationBell = document.getElementById('notificationBell');
    const notificationDropdown = document.getElementById('notificationDropdown');
    const markReadBtn = document.getElementById('markReadBtn');

    if (notificationBell && notificationDropdown) {
        notificationBell.addEventListener('click', (e) => {
            e.stopPropagation();
            notificationDropdown.classList.toggle('active');
            if (notificationDropdown.classList.contains('active')) {
                loadNotifications();
            }
        });

        document.addEventListener('click', () => notificationDropdown.classList.remove('active'));
        notificationDropdown.addEventListener('click', (e) => e.stopPropagation());
    }

    if (markReadBtn) {
        markReadBtn.addEventListener('click', () => {
            fetch('/api/notifications/read', { method: 'POST' })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        loadNotifications();
                        showToast("All notifications marked as read!");
                    }
                });
        });
    }

    // 4. Quick Add Contact modal triggers
    const quickAddBtn = document.getElementById('quickAddBtn');
    const quickAddModal = document.getElementById('quickAddModal');
    const quickAddCloseBtn = document.getElementById('quickAddCloseBtn');
    const quickAddCancelBtn = document.getElementById('quickAddCancelBtn');
    const quickAddContactForm = document.getElementById('quickAddContactForm');

    if (quickAddBtn && quickAddModal) {
        quickAddBtn.addEventListener('click', () => {
            quickAddContactForm.reset();
            quickAddModal.classList.add('active');
        });
        
        const closeQuickAdd = () => quickAddModal.classList.remove('active');
        quickAddCloseBtn.addEventListener('click', closeQuickAdd);
        quickAddCancelBtn.addEventListener('click', closeQuickAdd);
        
        quickAddContactForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = new FormData(quickAddContactForm);
            
            const firstName = quickAddContactForm.querySelector('[name="firstName"]')?.value || '';
            const lastName = quickAddContactForm.querySelector('[name="lastName"]')?.value || '';
            const mobile = quickAddContactForm.querySelector('[name="mobile"]')?.value || '';
            const category = quickAddContactForm.querySelector('[name="category"]')?.value || 'Personal';
            
            closeQuickAdd();
            showToast(`Contact '${firstName}' successfully created!`);
            
            let backupStats = null;
            let tempContactId = 'temp_' + Date.now();
            
            if (dashboardStatsData) {
                backupStats = JSON.parse(JSON.stringify(dashboardStatsData));
                dashboardStatsData.summary.totalContacts = (dashboardStatsData.summary.totalContacts || 0) + 1;
                
                const tempContact = {
                    contactId: tempContactId,
                    firstName: firstName,
                    lastName: lastName,
                    mobile: mobile,
                    category: category,
                    photo: '/static/images/default-avatar.svg'
                };
                
                if (!dashboardStatsData.recentContacts) dashboardStatsData.recentContacts = [];
                dashboardStatsData.recentContacts.unshift(tempContact);
                if (dashboardStatsData.recentContacts.length > 5) {
                    dashboardStatsData.recentContacts = dashboardStatsData.recentContacts.slice(0, 5);
                }
                
                if (!dashboardStatsData.categoryDistribution) dashboardStatsData.categoryDistribution = {};
                dashboardStatsData.categoryDistribution[category] = (dashboardStatsData.categoryDistribution[category] || 0) + 1;
                
                // Update KPI text Content
                const kpiTotal = document.getElementById('kpiTotalContacts');
                if (kpiTotal) kpiTotal.textContent = dashboardStatsData.summary.totalContacts;
                
                renderRecentContacts(dashboardStatsData.recentContacts);
                renderDashboardCharts();
            }
            
            fetch('/api/contacts', {
                method: 'POST',
                body: formData
            })
            .then(res => {
                if (!res.ok) throw new Error("Could not create contact");
                return res.json();
            })
            .then(data => {
                if (dashboardStatsData) {
                    const idx = dashboardStatsData.recentContacts.findIndex(c => c.contactId === tempContactId);
                    if (idx !== -1) {
                        dashboardStatsData.recentContacts[idx] = data;
                        renderRecentContacts(dashboardStatsData.recentContacts);
                    }
                }
                if (window.activePage === 'contacts' && typeof loadContacts === 'function') {
                    loadContacts();
                }
            })
            .catch(err => {
                showToast(err.message, 'error');
                if (backupStats) {
                    dashboardStatsData = backupStats;
                    const kpiTotal = document.getElementById('kpiTotalContacts');
                    if (kpiTotal) kpiTotal.textContent = dashboardStatsData.summary.totalContacts;
                    renderRecentContacts(dashboardStatsData.recentContacts);
                    renderDashboardCharts();
                }
            });
        });
    }

    // Initial Notifications check
    if (document.getElementById('notificationBell')) {
        loadNotifications();
        setInterval(loadNotifications, 60000); // Check every minute
    }

    // Run active page scripts
    initializeActivePage();
});

/* ==========================================================================
   AUTHENTICATION LOGIC (LOCAL & FIREBASE)
   ========================================================================== */
let firebaseAuthInstance = null;

// Tab switcher for auth views
function switchAuthMode(mode) {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const forgotForm = document.getElementById('forgotForm');
    const authTabs = document.getElementById('authTabs');
    const subtitle = document.getElementById('authSubtitle');
    const alertBox = document.getElementById('authAlert');

    if (alertBox) alertBox.style.display = 'none';

    // Hide all
    if (loginForm) loginForm.classList.remove('active');
    if (registerForm) registerForm.classList.remove('active');
    if (forgotForm) forgotForm.classList.remove('active');

    const tabButtons = authTabs ? authTabs.querySelectorAll('.auth-tab-btn') : [];
    tabButtons.forEach(btn => btn.classList.remove('active'));

    if (mode === 'login') {
        if (loginForm) loginForm.classList.add('active');
        if (tabButtons[0]) tabButtons[0].classList.add('active');
        if (subtitle) subtitle.textContent = "Sign in to your CRM workspace";
        if (authTabs) authTabs.style.display = 'flex';
    } else if (mode === 'register') {
        if (registerForm) registerForm.classList.add('active');
        if (tabButtons[1]) tabButtons[1].classList.add('active');
        if (subtitle) subtitle.textContent = "Create your CRM account";
        if (authTabs) authTabs.style.display = 'flex';
    } else if (mode === 'forgot') {
        if (forgotForm) forgotForm.classList.add('active');
        if (subtitle) subtitle.textContent = "Reset account credentials";
        if (authTabs) authTabs.style.display = 'none';
    }
    lucide.createIcons();
}

// Initialize Auth handlers
function initAuthHandlers() {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const forgotForm = document.getElementById('forgotForm');
    const alertBox = document.getElementById('authAlert');
    let isLocalAuthMode = !window.firebaseEnabled;

    const showAlert = (msg, type = 'error') => {
        if (!alertBox) return;
        alertBox.textContent = msg;
        alertBox.className = `auth-alert ${type}`;
        alertBox.style.display = 'block';
    };

    if (window.firebaseEnabled) {
        // Initialize Firebase SDK
        fetch('/api/config')
            .then(res => res.json())
            .then(data => {
                if (data.firebaseEnabled && data.config.apiKey) {
                    firebase.initializeApp(data.config);
                    firebaseAuthInstance = firebase.auth();
                    console.log("Firebase client sdk initialized.");
                } else {
                    console.error("Firebase enabled on backend but client keys missing. Using local database auth fallback.");
                    isLocalAuthMode = true;
                }
            })
            .catch(err => {
                console.error("Could not fetch configurations", err);
                isLocalAuthMode = true;
            });
    }

    // Submit LOGIN form
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;
            toggleLoader('loginBtn', true, 'Sign In');

            if (firebaseAuthInstance) {
                // Firebase Login Flow
                try {
                    const userCredential = await firebaseAuthInstance.signInWithEmailAndPassword(email, password);
                    const idToken = await userCredential.user.getIdToken();
                    
                    // Verify ID token with Flask backend to set session
                    const res = await fetch('/api/auth/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ idToken })
                    });
                    const sessionData = await res.json();
                    
                    if (sessionData.success) {
                        const overlay = document.getElementById('loadingOverlay');
                        if (overlay) {
                            overlay.classList.add('active');
                            setTimeout(() => {
                                window.location.href = '/dashboard';
                            }, 1000);
                        } else {
                            window.location.href = '/dashboard';
                        }
                    } else {
                        showAlert(sessionData.error || "Session mapping failed.");
                    }
                } catch (err) {
                    showAlert(err.message);
                } finally {
                    toggleLoader('loginBtn', false, 'Sign In');
                }
            } else if (isLocalAuthMode) {
                // Local DB Auth Flow
                try {
                    const res = await fetch('/api/auth/login-local', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, password })
                    });
                    const sessionData = await res.json();
                    
                    if (res.ok && sessionData.success) {
                        const overlay = document.getElementById('loadingOverlay');
                        if (overlay) {
                            overlay.classList.add('active');
                            setTimeout(() => {
                                window.location.href = '/dashboard';
                            }, 1000);
                        } else {
                            window.location.href = '/dashboard';
                        }
                    } else {
                        showAlert(sessionData.error || "Invalid credentials or login failed.");
                    }
                } catch (err) {
                    showAlert(err.message);
                } finally {
                    toggleLoader('loginBtn', false, 'Sign In');
                }
            } else {
                showAlert("Firebase initialization is pending. Please wait or reload.");
                toggleLoader('loginBtn', false, 'Sign In');
            }
        });
    }

    // Submit REGISTER form
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fullName = document.getElementById('regName').value;
            const email = document.getElementById('regEmail').value;
            const password = document.getElementById('regPassword').value;
            const confirmPassword = document.getElementById('regConfirmPassword').value;

            if (password.length < 8) {
                showAlert("Password must be at least 8 characters.");
                return;
            }
            if (password !== confirmPassword) {
                showAlert("Passwords do not match.");
                return;
            }

            toggleLoader('registerBtn', true, 'Create Account');

            const overlay = document.getElementById('loadingOverlay');
            const loadingText = document.getElementById('loadingText');
            if (overlay) {
                overlay.classList.add('active');
                if (loadingText) loadingText.textContent = "Creating secure account...";
            }

            if (firebaseAuthInstance) {
                // Firebase Register Flow
                try {
                    const userCredential = await firebaseAuthInstance.createUserWithEmailAndPassword(email, password);
                    
                    if (loadingText) loadingText.textContent = "Updating user profile...";
                    await userCredential.user.updateProfile({ displayName: fullName });
                    const idToken = await userCredential.user.getIdToken();
                    
                    if (loadingText) loadingText.textContent = "Syncing profile to database...";
                    // Call Flask API to register/sync profile (WITHOUT setting login session)
                    const res = await fetch('/api/auth/register', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ idToken })
                    });
                    const registerData = await res.json();
                    
                    if (registerData.success) {
                        // Sign out of Firebase client SDK to ensure they must login manually
                        await firebaseAuthInstance.signOut();
                        if (loadingText) loadingText.textContent = "Account created successfully!";
                        
                        setTimeout(() => {
                            if (overlay) overlay.classList.remove('active');
                            showAlert("Account created successfully! Redirecting to login page...", "success");
                            setTimeout(() => {
                                window.location.href = '/login';
                            }, 1000);
                        }, 1200);
                    } else {
                        if (overlay) overlay.classList.remove('active');
                        showAlert(registerData.error || "Failed to sync account profile with database.");
                    }
                } catch (err) {
                    if (overlay) overlay.classList.remove('active');
                    showAlert(err.message);
                } finally {
                    toggleLoader('registerBtn', false, 'Create Account');
                }
            } else if (isLocalAuthMode) {
                // Local DB Register Flow
                try {
                    const res = await fetch('/api/auth/register-local', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fullName, email, password })
                    });
                    const registerData = await res.json();
                    
                    if (res.ok && registerData.success) {
                        if (loadingText) loadingText.textContent = "Account created successfully!";
                        
                        setTimeout(() => {
                            if (overlay) overlay.classList.remove('active');
                            showAlert("Account created successfully! Redirecting to login page...", "success");
                            setTimeout(() => {
                                window.location.href = '/login';
                            }, 1000);
                        }, 1200);
                    } else {
                        if (overlay) overlay.classList.remove('active');
                        showAlert(registerData.error || "Failed to create local account.");
                    }
                } catch (err) {
                    if (overlay) overlay.classList.remove('active');
                    showAlert(err.message);
                } finally {
                    toggleLoader('registerBtn', false, 'Create Account');
                }
            } else {
                if (overlay) overlay.classList.remove('active');
                showAlert("Firebase initialization is pending. Please wait or reload.");
                toggleLoader('registerBtn', false, 'Create Account');
            }
        });
    }

    // Submit FORGOT password form
    if (forgotForm) {
        forgotForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('forgotEmail').value;
            toggleLoader('forgotBtn', true, 'Send Reset Instructions');

            if (firebaseAuthInstance) {
                try {
                    await firebaseAuthInstance.sendPasswordResetEmail(email);
                    showAlert("Instructions sent! Check your inbox email.", 'success');
                } catch (err) {
                    showAlert(err.message);
                } finally {
                    toggleLoader('forgotBtn', false, 'Send Reset Instructions');
                }
            } else if (isLocalAuthMode) {
                try {
                    const res = await fetch('/api/auth/forgot-password', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email, isLocal: true })
                    });
                    const resData = await res.json();
                    if (res.ok && resData.success) {
                        showAlert(resData.message || "Simulated password reset instructions sent successfully.", 'success');
                    } else {
                        showAlert(resData.error || "Could not process request.");
                    }
                } catch (err) {
                    showAlert(err.message);
                } finally {
                    toggleLoader('forgotBtn', false, 'Send Reset Instructions');
                }
            } else {
                showAlert("Firebase initialization is pending. Please wait or reload.");
                toggleLoader('forgotBtn', false, 'Send Reset Instructions');
            }
        });
    }
}

/* ==========================================================================
   GLOBAL NOTIFICATION LOADER
   ========================================================================== */
function loadNotifications() {
    const list = document.getElementById('notificationList');
    const badge = document.getElementById('notificationBadge');
    if (!list) return;

    fetch('/api/notifications')
        .then(res => res.json())
        .then(notifs => {
            let unreadCount = 0;
            list.innerHTML = '';
            
            if (notifs.length === 0) {
                list.innerHTML = `<div class="dropdown-empty-state">No new notifications.</div>`;
                if (badge) badge.style.display = 'none';
                return;
            }

            notifs.forEach(n => {
                if (!n.read) unreadCount++;
                const item = document.createElement('div');
                item.className = `notif-item ${!n.read ? 'unread' : ''}`;
                
                let icon = 'info';
                if (n.type === 'Contact') icon = 'user-plus';
                if (n.type === 'Reminder') icon = 'bell';

                // Format time
                let dateStr = 'Just now';
                if (n.createdAt) {
                    const d = new Date(n.createdAt);
                    dateStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
                }

                item.innerHTML = `
                    <div class="notif-icon-wrap notif-type-${n.type}">
                        <i data-lucide="${icon}"></i>
                    </div>
                    <div class="notif-details">
                        <span class="notif-msg">${n.message}</span>
                        <span class="notif-time">${dateStr}</span>
                    </div>
                `;
                list.appendChild(item);
            });

            lucide.createIcons();

            if (badge) {
                if (unreadCount > 0) {
                    badge.textContent = unreadCount;
                    badge.style.display = 'flex';
                } else {
                    badge.style.display = 'none';
                }
            }
        })
        .catch(err => console.error("Error fetching notifications", err));
}

/* ==========================================================================
   PAGE SPECIFIC INITIALIZERS
   ========================================================================== */
function initializeActivePage() {
    const page = window.activePage || '';
    if (!page) {
        // We are on auth page if forms exist
        if (document.getElementById('loginForm') || document.getElementById('registerForm')) {
            initAuthHandlers();
        }
        return;
    }

    if (page === 'dashboard') {
        loadDashboardStats();
    } else if (page === 'contacts') {
        initContactsPage();
    } else if (page === 'groups') {
        initGroupsPage();
    } else if (page === 'profile') {
        initProfilePage();
    }
}

/* ==========================================================================
   DASHBOARD CONTROLLER
   ========================================================================== */
let categoryChart = null;
let growthChart = null;
let dashboardStatsData = null;

function loadDashboardStats() {
    fetch('/api/dashboard/stats')
        .then(res => res.json())
        .then(data => {
            dashboardStatsData = data;
            
            // 1. Set KPI Metrics
            document.getElementById('kpiTotalContacts').textContent = data.summary.totalContacts;
            document.getElementById('kpiFavorites').textContent = data.summary.favorites;
            document.getElementById('kpiEmergency').textContent = data.summary.emergency;
            const kpiBirthdaysEl = document.getElementById('kpiBirthdays');
            if (kpiBirthdaysEl) kpiBirthdaysEl.textContent = data.summary.upcomingBirthdaysCount;

            // 2. Render lists
            renderRecentContacts(data.recentContacts);
            renderBirthdayList(data.birthdayCalendar);
            renderActivityFeed(data.recentActivities);

            // 3. Render charts
            renderDashboardCharts();
        })
        .catch(err => console.error("Error loading dashboard stats", err));
}

function renderRecentContacts(contacts) {
    const list = document.getElementById('recentContactsList');
    if (!list) return;
    list.innerHTML = '';

    if (contacts.length === 0) {
        list.innerHTML = `<div class="widget-empty-state">No contacts added yet.</div>`;
        return;
    }

    contacts.forEach(c => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML = `
            <img src="${c.photo || '/static/images/default-avatar.svg'}" alt="Avatar" class="item-avatar">
            <div class="item-details">
                <span class="item-name">${c.firstName} ${c.lastName || ''}</span>
                <span class="item-meta">${c.company || 'No Company'} • ${c.mobile}</span>
            </div>
            <span class="item-badge-pill badge-blue">${c.category}</span>
        `;
        list.appendChild(item);
    });
}

function renderBirthdayList(birthdays) {
    const list = document.getElementById('birthdayList');
    const badge = document.getElementById('birthdayBadge');
    if (!list) return;
    list.innerHTML = '';

    const todayCount = birthdays.filter(b => b.daysLeft === 0).length;
    if (badge) badge.textContent = `${todayCount} Today`;

    if (birthdays.length === 0) {
        list.innerHTML = `<div class="widget-empty-state">No birthdays in next 30 days.</div>`;
        return;
    }

    birthdays.forEach(b => {
        const item = document.createElement('div');
        item.className = 'list-item';
        
        let sub = `In ${b.daysLeft} days`;
        if (b.daysLeft === 0) sub = `<b>Celebrating Today! 🎂</b>`;
        else if (b.daysLeft === 1) sub = `Tomorrow`;

        item.innerHTML = `
            <img src="${b.photo || '/static/images/default-avatar.svg'}" alt="Avatar" class="item-avatar">
            <div class="item-details">
                <span class="item-name">${b.name}</span>
                <span class="item-meta">${sub}</span>
            </div>
            <span class="days-left-count">${new Date(b.date).toLocaleDateString([], {month: 'short', day:'numeric'})}</span>
        `;
        list.appendChild(item);
    });
}



function renderActivityFeed(activities) {
    const feed = document.getElementById('activityFeed');
    if (!feed) return;
    feed.innerHTML = '';

    if (activities.length === 0) {
        feed.innerHTML = `<div class="widget-empty-state">No recent activities logs.</div>`;
        return;
    }

    activities.forEach(a => {
        const item = document.createElement('div');
        item.className = `activity-item ${a.type}`;
        
        let dateStr = 'Just now';
        if (a.timestamp) {
            const d = new Date(a.timestamp);
            dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        item.innerHTML = `
            <div class="activity-dot"></div>
            <span class="activity-text">${a.message}</span>
            <span class="activity-time">${dateStr}</span>
        `;
        feed.appendChild(item);
    });
}

function renderDashboardCharts() {
    if (!dashboardStatsData) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    
    // Theme sensitive variables
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)';
    const labelColor = isDark ? '#9CA3AF' : '#64748B';

    // 1. Category Doughnut Chart
    const catCanvas = document.getElementById('categoryChart');
    if (catCanvas) {
        if (categoryChart) categoryChart.destroy();
        
        const catData = dashboardStatsData.categoryDistribution || {};
        const labels = Object.keys(catData);
        const values = Object.values(catData);
        const total = values.reduce((sum, val) => sum + val, 0);
        
        const emptyState = document.getElementById('categoryChartEmptyState');
        if (total === 0) {
            catCanvas.style.display = 'none';
            if (emptyState) {
                emptyState.style.display = 'flex';
                if (window.lucide) window.lucide.createIcons();
            }
        } else {
            catCanvas.style.display = 'block';
            if (emptyState) emptyState.style.display = 'none';
            
            categoryChart = new Chart(catCanvas, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        data: values,
                        backgroundColor: [
                            '#2563EB', // Primary Blue
                            '#10B981', // Success Emerald
                            '#F59E0B', // Warning Amber
                            '#EF4444', // Danger Red
                            '#06B6D4', // Info Cyan
                            '#3B82F6', // Light Blue
                            '#64748B'  // Muted Slate
                        ],
                        borderWidth: isDark ? 2 : 1,
                        borderColor: isDark ? '#111827' : '#ffffff'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'right',
                            labels: {
                                color: labelColor,
                                font: { family: 'Inter', size: 11 }
                            }
                        }
                    }
                }
            });
        }
    }

    // 2. Growth Line Chart
    const growthCanvas = document.getElementById('growthChart');
    if (growthCanvas) {
        if (growthChart) growthChart.destroy();

        const growthData = dashboardStatsData.monthlyGrowth || { labels: [], data: [] };
        const hasGrowth = growthData.data && growthData.data.some(val => val > 0);
        
        const emptyState = document.getElementById('growthChartEmptyState');
        if (!hasGrowth) {
            growthCanvas.style.display = 'none';
            if (emptyState) {
                emptyState.style.display = 'flex';
                if (window.lucide) window.lucide.createIcons();
            }
        } else {
            growthCanvas.style.display = 'block';
            if (emptyState) emptyState.style.display = 'none';

            // Cumulative count calculation
            let cumSum = 0;
            const cumulativeValues = growthData.data.map(val => {
                cumSum += val;
                return cumSum;
            });

            const ctx = growthCanvas.getContext('2d');
            
            // Gradient fill
            const gradient = ctx.createLinearGradient(0, 0, 0, 240);
            gradient.addColorStop(0, 'rgba(37, 99, 235, 0.2)');
            gradient.addColorStop(1, 'rgba(37, 99, 235, 0)');

            growthChart = new Chart(growthCanvas, {
                type: 'line',
                data: {
                    labels: growthData.labels,
                    datasets: [{
                        label: 'Contacts Added',
                        data: cumulativeValues,
                        borderColor: '#2563EB',
                        borderWidth: 2,
                        tension: 0.35,
                        fill: true,
                        backgroundColor: gradient,
                        pointBackgroundColor: '#2563EB',
                        pointHoverRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        x: {
                            grid: { color: gridColor },
                            ticks: { color: labelColor, font: { family: 'Inter' } }
                        },
                        y: {
                            grid: { color: gridColor },
                            ticks: { color: labelColor, font: { family: 'Inter' } },
                            beginAtZero: true
                        }
                    }
                }
            });
        }
    }
}

/* ==========================================================================
   CONTACTS MANAGEMENT DIRECTORY CONTROLLER
   ========================================================================== */
let contactsList = [];
let activeFilters = {
    search: '',
    category: '',
    favoritesOnly: false,
    emergencyOnly: false,
    birthdayMonth: ''
};

function initContactsPage() {
    const viewGridBtn = document.getElementById('viewGridBtn');
    const viewTableBtn = document.getElementById('viewTableBtn');
    const gridLayout = document.getElementById('contactsGrid');
    const tableLayout = document.getElementById('contactsTableContainer');

    // Layout Toggle checks
    const savedLayout = localStorage.getItem('contactsLayout') || 'grid';
    const setLayout = (layout) => {
        if (layout === 'grid') {
            viewGridBtn.classList.add('active');
            viewTableBtn.classList.remove('active');
            gridLayout.classList.add('active');
            tableLayout.classList.remove('active');
        } else {
            viewGridBtn.classList.remove('active');
            viewTableBtn.classList.add('active');
            gridLayout.classList.remove('active');
            tableLayout.classList.add('active');
        }
        localStorage.setItem('contactsLayout', layout);
    };

    viewGridBtn.addEventListener('click', () => setLayout('grid'));
    viewTableBtn.addEventListener('click', () => setLayout('table'));
    setLayout(savedLayout);

    // Initial contacts list retrieval
    loadContacts();

    // Setup input listeners for filtering
    const searchInput = document.getElementById('contactsSearchInput');
    const globalSearchInput = document.getElementById('globalSearchInput');
    const categorySelect = document.getElementById('filterCategory');
    const favoritesBtn = document.getElementById('filterFavoritesBtn');
    const emergencyBtn = document.getElementById('filterEmergencyBtn');
    const birthdayMonthSelect = document.getElementById('filterBirthdayMonth');
    const clearFiltersBtn = document.getElementById('clearFiltersBtn');

    const updateFilterDisplay = () => {
        const hasFilters = activeFilters.search || activeFilters.category || activeFilters.favoritesOnly || activeFilters.emergencyOnly || activeFilters.birthdayMonth;
        clearFiltersBtn.style.display = hasFilters ? 'inline-flex' : 'none';
        filterAndRenderContacts();
    };

    const handleSearch = (e) => {
        activeFilters.search = e.target.value.toLowerCase().trim();
        updateFilterDisplay();
    };

    if (searchInput) searchInput.addEventListener('input', handleSearch);
    if (globalSearchInput) globalSearchInput.addEventListener('input', (e) => {
        // Sync global bar with local contacts search if on contacts page
        if (searchInput) searchInput.value = e.target.value;
        activeFilters.search = e.target.value.toLowerCase().trim();
        updateFilterDisplay();
    });

    if (categorySelect) {
        categorySelect.addEventListener('change', (e) => {
            activeFilters.category = e.target.value;
            updateFilterDisplay();
        });
    }

    if (favoritesBtn) {
        favoritesBtn.addEventListener('click', () => {
            activeFilters.favoritesOnly = !activeFilters.favoritesOnly;
            favoritesBtn.classList.toggle('active', activeFilters.favoritesOnly);
            updateFilterDisplay();
        });
    }

    if (emergencyBtn) {
        emergencyBtn.addEventListener('click', () => {
            activeFilters.emergencyOnly = !activeFilters.emergencyOnly;
            emergencyBtn.classList.toggle('active', activeFilters.emergencyOnly);
            updateFilterDisplay();
        });
    }

    if (birthdayMonthSelect) {
        birthdayMonthSelect.addEventListener('change', (e) => {
            activeFilters.birthdayMonth = e.target.value;
            updateFilterDisplay();
        });
    }

    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', () => {
            activeFilters = { search: '', category: '', favoritesOnly: false, emergencyOnly: false, birthdayMonth: '' };
            if (searchInput) searchInput.value = '';
            if (globalSearchInput) globalSearchInput.value = '';
            if (categorySelect) categorySelect.value = '';
            if (birthdayMonthSelect) birthdayMonthSelect.value = '';
            favoritesBtn.classList.remove('active');
            emergencyBtn.classList.remove('active');
            updateFilterDisplay();
        });
    }

    // Modal Trigger Buttons
    const addContactBtn = document.getElementById('addContactBtn');
    const contactFormModal = document.getElementById('contactFormModal');
    const contactModalCloseBtn = document.getElementById('contactModalCloseBtn');
    const contactModalCancelBtn = document.getElementById('contactModalCancelBtn');
    const contactForm = document.getElementById('contactForm');
    
    // Photo upload preview handler
    const photoInput = document.getElementById('cPhoto');
    const avatarPreview = document.getElementById('formAvatarPreview');
    if (photoInput && avatarPreview) {
        photoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => avatarPreview.src = event.target.result;
                reader.readAsDataURL(file);
            }
        });
    }

    const openContactModal = (mode = 'add') => {
        contactForm.reset();
        document.getElementById('cContactId').value = '';
        avatarPreview.src = '/static/images/default-avatar.svg';
        
        if (mode === 'add') {
            document.getElementById('contactModalTitle').textContent = "New Contact";
            document.getElementById('contactModalSaveBtn').textContent = "Save Contact";
        }
        contactFormModal.classList.add('active');
    };

    if (addContactBtn) addContactBtn.addEventListener('click', () => openContactModal('add'));

    const closeContactModal = () => contactFormModal.classList.remove('active');
    if (contactModalCloseBtn) contactModalCloseBtn.addEventListener('click', closeContactModal);
    if (contactModalCancelBtn) contactModalCancelBtn.addEventListener('click', closeContactModal);

    // Save/Update Contact Submit Form
    if (contactForm) {
        contactForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const contactId = document.getElementById('cContactId').value;
            const formData = new FormData(contactForm);
            
            // Map checkboxes manually since empty checkboxes don't submit in FormData
            formData.set('favorite', document.getElementById('cFavorite').checked);
            formData.set('emergency', document.getElementById('cEmergency').checked);

            const isEdit = !!contactId;
            const url = isEdit ? `/api/contacts/${contactId}` : '/api/contacts';
            
            const firstName = document.getElementById('cFirstName').value;
            const lastName = document.getElementById('cLastName').value;
            const mobile = document.getElementById('cMobile').value;
            const alternateNumber = document.getElementById('cAlternateNumber').value;
            const email = document.getElementById('cEmail').value;
            const website = document.getElementById('cWebsite').value;
            const company = document.getElementById('cCompany').value;
            const designation = document.getElementById('cDesignation').value;
            const birthday = document.getElementById('cBirthday').value;
            const category = document.getElementById('cCategory').value;
            const address = document.getElementById('cAddress').value;
            const notes = document.getElementById('cNotes').value;
            const favorite = document.getElementById('cFavorite').checked;
            const emergency = document.getElementById('cEmergency').checked;
            const photo = document.getElementById('formAvatarPreview').src;

            closeContactModal();
            showToast(`Contact '${firstName}' successfully ${isEdit ? 'updated' : 'created'}!`);

            if (isEdit) {
                const index = contactsList.findIndex(c => c.contactId === contactId);
                const originalContact = index !== -1 ? { ...contactsList[index] } : null;
                
                if (index !== -1) {
                    contactsList[index] = {
                        ...contactsList[index],
                        firstName, lastName, mobile, alternateNumber, email, website,
                        company, designation, birthday, category, address, notes,
                        favorite, emergency,
                        photo: photo.startsWith('data:') ? photo : contactsList[index].photo
                    };
                    filterAndRenderContacts();
                }

                fetch(url, {
                    method: 'POST',
                    body: formData
                })
                .then(res => {
                    if (!res.ok) throw new Error("Operation failed");
                    return res.json();
                })
                .then(data => {
                    if (index !== -1) {
                        contactsList[index] = data;
                        filterAndRenderContacts();
                    }
                })
                .catch(err => {
                    showToast("Failed to save contact. Reverting changes.", "error");
                    if (originalContact && index !== -1) {
                        contactsList[index] = originalContact;
                        filterAndRenderContacts();
                    }
                });
            } else {
                const tempId = 'temp_' + Date.now();
                const tempContact = {
                    contactId: tempId,
                    firstName, lastName, mobile, alternateNumber, email, website,
                    company, designation, birthday, category, address, notes,
                    favorite, emergency,
                    photo: photo.startsWith('data:') ? photo : '/static/images/default-avatar.svg'
                };
                contactsList.push(tempContact);
                filterAndRenderContacts();

                fetch(url, {
                    method: 'POST',
                    body: formData
                })
                .then(res => {
                    if (!res.ok) throw new Error("Operation failed");
                    return res.json();
                })
                .then(data => {
                    const idx = contactsList.findIndex(c => c.contactId === tempId);
                    if (idx !== -1) {
                        contactsList[idx] = data;
                        filterAndRenderContacts();
                    }
                })
                .catch(err => {
                    showToast("Failed to create contact.", "error");
                    const idx = contactsList.findIndex(c => c.contactId === tempId);
                    if (idx !== -1) {
                        contactsList.splice(idx, 1);
                        filterAndRenderContacts();
                    }
                });
            }
        });
    }

    // CSV Modal triggers
    const importCsvBtn = document.getElementById('importCsvBtn');
    const importCsvModal = document.getElementById('importCsvModal');
    const csvModalCloseBtn = document.getElementById('csvModalCloseBtn');
    const csvModalCancelBtn = document.getElementById('csvModalCancelBtn');
    const csvImportForm = document.getElementById('csvImportForm');

    if (importCsvBtn && importCsvModal) {
        importCsvBtn.addEventListener('click', () => {
            csvImportForm.reset();
            document.getElementById('csvValidationInfo').style.display = 'none';
            importCsvModal.classList.add('active');
        });

        const closeCsvModal = () => importCsvModal.classList.remove('active');
        csvModalCloseBtn.addEventListener('click', closeCsvModal);
        csvModalCancelBtn.addEventListener('click', closeCsvModal);

        csvImportForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const fileInput = document.getElementById('csvFile');
            if (fileInput.files.length === 0) return;

            const formData = new FormData();
            formData.append('file', fileInput.files[0]);

            toggleLoader('csvImportSubmitBtn', true, 'Upload & Import');

            fetch('/api/contacts/import-csv', {
                method: 'POST',
                body: formData
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    showToast(`Successfully imported ${data.imported} contacts!`);
                    closeCsvModal();
                    loadContacts();
                } else {
                    showToast(data.error, 'error');
                }
            })
            .catch(err => showToast("Failed to upload file.", 'error'))
            .finally(() => toggleLoader('csvImportSubmitBtn', false, 'Upload & Import'));
        });
    }

    // Delete Modal triggers
    const deleteModal = document.getElementById('deleteConfirmModal');
    const deleteConfirmBtn = document.getElementById('deleteModalConfirmBtn');
    const deleteCancelBtn = document.getElementById('deleteModalCancelBtn');
    const deleteCloseBtn = document.getElementById('deleteModalCloseBtn');

    if (deleteConfirmBtn && deleteModal) {
        const closeDelete = () => deleteModal.classList.remove('active');
        deleteCancelBtn.addEventListener('click', closeDelete);
        deleteCloseBtn.addEventListener('click', closeDelete);

        deleteConfirmBtn.addEventListener('click', () => {
            const contactId = deleteConfirmBtn.dataset.contactId;
            if (!contactId) return;

            const idx = contactsList.findIndex(c => c.contactId === contactId);
            const originalContact = idx !== -1 ? contactsList[idx] : null;
            if (idx !== -1) {
                contactsList.splice(idx, 1);
            }

            filterAndRenderContacts();
            closeDelete();
            const detailsDrawer = document.getElementById('contactDetailsDrawer');
            if (detailsDrawer) detailsDrawer.classList.remove('active');
            showToast("Contact deleted successfully.");

            fetch(`/api/contacts/${contactId}`, { method: 'DELETE' })
                .then(res => res.json())
                .then(data => {
                    if (!data.success) {
                        throw new Error(data.error || "Could not delete contact.");
                    }
                })
                .catch(err => {
                    showToast(err.message || "Could not delete contact.", 'error');
                    if (originalContact && idx !== -1) {
                        contactsList.splice(idx, 0, originalContact);
                        filterAndRenderContacts();
                    }
                });
        });
    }

    // Details Drawer Close
    const detailsDrawer = document.getElementById('contactDetailsDrawer');
    const detailsDrawerClose = document.getElementById('detailsDrawerCloseBtn');
    if (detailsDrawerClose && detailsDrawer) {
        detailsDrawerClose.addEventListener('click', () => detailsDrawer.classList.remove('active'));
    }
}

function loadContacts() {
    fetch('/api/contacts')
        .then(res => res.json())
        .then(contacts => {
            contactsList = contacts;
            filterAndRenderContacts();
        })
        .catch(err => console.error("Error loading contacts", err));
}

function filterAndRenderContacts() {
    const grid = document.getElementById('contactsGrid');
    const tableBody = document.getElementById('contactsTableBody');
    if (!grid || !tableBody) return;

    // Apply active filter
    const filtered = contactsList.filter(c => {
        // 1. Search text mapping
        if (activeFilters.search) {
            const fn = (c.firstName || '').toLowerCase();
            const ln = (c.lastName || '').toLowerCase();
            const email = (c.email || '').toLowerCase();
            const mob = (c.mobile || '').toLowerCase();
            const comp = (c.company || '').toLowerCase();
            const q = activeFilters.search;
            if (!fn.includes(q) && !ln.includes(q) && !email.includes(q) && !mob.includes(q) && !comp.includes(q)) {
                return false;
            }
        }
        // 2. Category mapping
        if (activeFilters.category && c.category !== activeFilters.category) {
            return false;
        }
        // 3. Favorites mapping
        if (activeFilters.favoritesOnly && !c.favorite) {
            return false;
        }
        // 4. Emergency mapping
        if (activeFilters.emergencyOnly && !c.emergency) {
            return false;
        }
        // 5. Birthday month mapping
        if (activeFilters.birthdayMonth) {
            const b = c.birthday; // Expected "YYYY-MM-DD"
            if (!b || b.split('-')[1] !== activeFilters.birthdayMonth) {
                return false;
            }
        }
        return true;
    });

    // Render Grid View
    grid.innerHTML = '';
    if (filtered.length === 0) {
        grid.innerHTML = `<div class="widget-empty-state">No contacts match the active filters.</div>`;
    } else {
        filtered.forEach(c => {
            const card = document.createElement('div');
            card.className = 'contact-card';
            card.setAttribute('data-contact-id', c.contactId);
            card.setAttribute('onclick', `openContactDetailDrawer('${c.contactId}', event)`);

            // Badges string
            let badgeHtml = '';
            if (c.favorite) badgeHtml += `<i data-lucide="star" class="icon-badge-star"></i>`;
            if (c.emergency) badgeHtml += `<i data-lucide="shield-alert" class="icon-badge-emergency"></i>`;

            card.innerHTML = `
                <div class="contact-card-header">
                    <img src="${c.photo || '/static/images/default-avatar.svg'}" alt="Avatar" class="card-avatar">
                    <div class="card-title-details">
                        <div class="card-name-row">
                            <span class="card-fullname">${c.firstName} ${c.lastName || ''}</span>
                            ${badgeHtml}
                        </div>
                        <span class="card-headline">${c.designation || 'No title'} • ${c.company || 'Private'}</span>
                    </div>
                </div>
                <div class="contact-card-body">
                    <div class="body-info-row">
                        <i data-lucide="phone"></i>
                        <span>${c.mobile}</span>
                    </div>
                    ${c.email ? `
                    <div class="body-info-row">
                        <i data-lucide="mail"></i>
                        <span>${c.email}</span>
                    </div>` : ''}
                </div>
                <div class="contact-card-footer">
                    <span class="tag-badge ${c.emergency ? 'badge-emergency' : ''}">${c.category}</span>
                    <div class="card-action-btns">
                        <button class="card-mini-btn" onclick="openEditContact('${c.contactId}', event)" aria-label="Edit Contact">
                            <i data-lucide="edit-2"></i>
                        </button>
                        <button class="card-mini-btn btn-delete" onclick="confirmDeleteContact('${c.contactId}', '${c.firstName} ${c.lastName || ''}', event)" aria-label="Delete Contact">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });
    }

    // Render Table View
    tableBody.innerHTML = '';
    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" class="widget-empty-state">No contacts found matching the selection criteria.</td></tr>`;
    } else {
        filtered.forEach(c => {
            const tr = document.createElement('tr');
            tr.setAttribute('data-contact-id', c.contactId);
            tr.setAttribute('onclick', `openContactDetailDrawer('${c.contactId}', event)`);

            tr.innerHTML = `
                <td>
                    <div class="table-avatar-cell">
                        <img src="${c.photo || '/static/images/default-avatar.svg'}" alt="Avatar" class="table-avatar">
                        <span class="table-fullname">${c.firstName} ${c.lastName || ''}</span>
                        ${c.favorite ? '⭐' : ''}
                        ${c.emergency ? '🚨' : ''}
                    </div>
                </td>
                <td>${c.mobile}</td>
                <td>${c.email || '-'}</td>
                <td><span class="tag-badge">${c.category}</span></td>
                <td>${c.company || '-'}</td>
                <td>
                    <div class="card-action-btns" onclick="event.stopPropagation();">
                        <button class="card-mini-btn" onclick="openEditContact('${c.contactId}')" aria-label="Edit">
                            <i data-lucide="edit-2"></i>
                        </button>
                        <button class="card-mini-btn btn-delete" onclick="confirmDeleteContact('${c.contactId}', '${c.firstName} ${c.lastName || ''}')" aria-label="Delete">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    }

    lucide.createIcons();
}

function openContactDetailDrawer(id, event) {
    // Prevent triggering drawer if click is on action button
    if (event && event.target.closest('.card-mini-btn')) return;

    const drawer = document.getElementById('contactDetailsDrawer');
    const drawerBody = document.getElementById('detailsDrawerBody');
    if (!drawer || !drawerBody) return;

    fetch(`/api/contacts/${id}`)
        .then(res => res.json())
        .then(c => {
            drawerBody.innerHTML = `
                <div class="detail-avatar-container">
                    <img src="${c.photo || '/static/images/default-avatar.svg'}" alt="Avatar" class="detail-avatar">
                    <h2 class="detail-name">
                        ${c.firstName} ${c.lastName || ''}
                        ${c.favorite ? '⭐' : ''}
                        ${c.emergency ? '🚨' : ''}
                    </h2>
                    <span class="detail-headline">${c.designation || 'No Designation'} • ${c.company || 'Private'}</span>
                </div>

                <div class="detail-grid">
                    <div class="detail-row">
                        <span class="detail-label">Primary Mobile</span>
                        <span class="detail-value">${c.mobile}</span>
                    </div>
                    ${c.alternateNumber ? `
                    <div class="detail-row">
                        <span class="detail-label">Alternate Number</span>
                        <span class="detail-value">${c.alternateNumber}</span>
                    </div>` : ''}
                    <div class="detail-row">
                        <span class="detail-label">Email Address</span>
                        <span class="detail-value">${c.email || '-'}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Category Group</span>
                        <span class="detail-value"><span class="tag-badge">${c.category}</span></span>
                    </div>
                    ${c.website ? `
                    <div class="detail-row">
                        <span class="detail-label">Website Domain</span>
                        <span class="detail-value"><a href="${c.website}" target="_blank">${c.website}</a></span>
                    </div>` : ''}
                    ${c.address ? `
                    <div class="detail-row">
                        <span class="detail-label">Physical Address</span>
                        <span class="detail-value">${c.address}</span>
                    </div>` : ''}
                    ${c.birthday ? `
                    <div class="detail-row">
                        <span class="detail-label">Birthday milestone</span>
                        <span class="detail-value">${c.birthday}</span>
                    </div>` : ''}
                    ${c.notes ? `
                    <div class="detail-row">
                        <span class="detail-label">Personal Notes</span>
                        <div class="detail-notes-box">${c.notes}</div>
                    </div>` : ''}
                </div>

                <div class="drawer-actions-row">
                    <a href="/api/contacts/export-pdf?contactId=${c.contactId}" class="secondary-btn" style="justify-content: center;">
                        <i data-lucide="file-text"></i>
                        <span>Export PDF</span>
                    </a>
                    <button class="primary-btn" style="justify-content: center;" onclick="openEditContact('${c.contactId}')">
                        <i data-lucide="edit-2"></i>
                        <span>Edit Contact</span>
                    </button>
                </div>
            `;
            lucide.createIcons();
            drawer.classList.add('active');
        });
}

function openEditContact(id, event) {
    if (event) event.stopPropagation();

    fetch(`/api/contacts/${id}`)
        .then(res => res.json())
        .then(c => {
            // Fill out form values
            document.getElementById('cContactId').value = c.contactId;
            document.getElementById('cFirstName').value = c.firstName;
            document.getElementById('cLastName').value = c.lastName || '';
            document.getElementById('cMobile').value = c.mobile;
            document.getElementById('cAlternateNumber').value = c.alternateNumber || '';
            document.getElementById('cEmail').value = c.email || '';
            document.getElementById('cWebsite').value = c.website || '';
            document.getElementById('cCompany').value = c.company || '';
            document.getElementById('cDesignation').value = c.designation || '';
            document.getElementById('cBirthday').value = c.birthday || '';
            document.getElementById('cCategory').value = c.category;
            document.getElementById('cAddress').value = c.address || '';
            document.getElementById('cNotes').value = c.notes || '';
            document.getElementById('cFavorite').checked = !!c.favorite;
            document.getElementById('cEmergency').checked = !!c.emergency;
            
            // Set form image preview
            document.getElementById('formAvatarPreview').src = c.photo || '/static/images/default-avatar.svg';

            document.getElementById('contactModalTitle').textContent = "Edit Contact";
            document.getElementById('contactModalSaveBtn').textContent = "Update Contact";
            document.getElementById('contactFormModal').classList.add('active');
        });
}

function confirmDeleteContact(id, name, event) {
    if (event) event.stopPropagation();
    const modal = document.getElementById('deleteConfirmModal');
    document.getElementById('deleteContactName').textContent = name;
    document.getElementById('deleteModalConfirmBtn').dataset.contactId = id;
    modal.classList.add('active');
}

/* ==========================================================================
   GROUP MANAGEMENT CONTROLLER
   ========================================================================== */
let groupsList = [];
let allContactsForGroups = [];

function initGroupsPage() {
    loadGroups();

    // Create Group trigger
    const createGroupBtn = document.getElementById('createGroupBtn');
    const groupModal = document.getElementById('groupModal');
    const groupModalCloseBtn = document.getElementById('groupModalCloseBtn');
    const groupModalCancelBtn = document.getElementById('groupModalCancelBtn');
    const groupForm = document.getElementById('groupForm');

    if (createGroupBtn && groupModal) {
        createGroupBtn.addEventListener('click', () => {
            groupForm.reset();
            document.getElementById('gGroupId').value = '';
            document.getElementById('groupModalTitle').textContent = "Create Contact Group";
            document.getElementById('groupModalSaveBtn').textContent = "Save Group";
            groupModal.classList.add('active');
        });

        const closeGroupModal = () => groupModal.classList.remove('active');
        groupModalCloseBtn.addEventListener('click', closeGroupModal);
        groupModalCancelBtn.addEventListener('click', closeGroupModal);

        // Submit form
        groupForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const id = document.getElementById('gGroupId').value;
            const groupName = document.getElementById('gGroupName').value.trim();
            const description = document.getElementById('gDescription').value.trim();

            const isEdit = !!id;
            const method = isEdit ? 'PUT' : 'POST';
            const url = isEdit ? `/api/groups/${id}` : '/api/groups';
            const bodyData = { groupName, description };

            closeGroupModal();
            showToast(`Group successfully ${isEdit ? 'updated' : 'created'}!`);

            if (isEdit) {
                const idx = groupsList.findIndex(g => g.groupId === id);
                const originalGroup = idx !== -1 ? { ...groupsList[idx] } : null;
                if (idx !== -1) {
                    groupsList[idx].groupName = groupName;
                    groupsList[idx].description = description;
                }
                renderGroupsList();

                fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bodyData)
                })
                .then(res => {
                    if (!res.ok) throw new Error("Operation failed");
                    return res.json();
                })
                .catch(err => {
                    showToast(err.message, 'error');
                    if (originalGroup && idx !== -1) {
                        groupsList[idx] = originalGroup;
                        renderGroupsList();
                    }
                });
            } else {
                const tempGroupId = 'temp_' + Date.now();
                const tempGroup = {
                    groupId: tempGroupId,
                    groupName: groupName,
                    description: description,
                    contacts: []
                };
                groupsList.push(tempGroup);
                renderGroupsList();

                fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bodyData)
                })
                .then(res => {
                    if (!res.ok) throw new Error("Operation failed");
                    return res.json();
                })
                .then(data => {
                    const idx = groupsList.findIndex(g => g.groupId === tempGroupId);
                    if (idx !== -1) {
                        groupsList[idx] = data;
                        renderGroupsList();
                    }
                })
                .catch(err => {
                    showToast(err.message, 'error');
                    const idx = groupsList.findIndex(g => g.groupId === tempGroupId);
                    if (idx !== -1) {
                        groupsList.splice(idx, 1);
                        renderGroupsList();
                    }
                });
            }
        });
    }

    // Delete group confirmation setups
    const deleteGroupModal = document.getElementById('deleteGroupConfirmModal');
    const confirmDeleteBtn = document.getElementById('deleteGroupModalConfirmBtn');
    const cancelDeleteBtn = document.getElementById('deleteGroupModalCancelBtn');
    const closeDeleteBtn = document.getElementById('deleteGroupModalCloseBtn');

    if (confirmDeleteBtn && deleteGroupModal) {
        const closeDelete = () => deleteGroupModal.classList.remove('active');
        cancelDeleteBtn.addEventListener('click', closeDelete);
        closeDeleteBtn.addEventListener('click', closeDelete);

        confirmDeleteBtn.addEventListener('click', () => {
            const groupId = confirmDeleteBtn.dataset.groupId;
            if (!groupId) return;

            const idx = groupsList.findIndex(g => g.groupId === groupId);
            const originalGroup = idx !== -1 ? groupsList[idx] : null;
            if (idx !== -1) {
                groupsList.splice(idx, 1);
            }

            renderGroupsList();
            closeDelete();
            showToast("Group deleted successfully.");

            fetch(`/api/groups/${groupId}`, { method: 'DELETE' })
                .then(res => res.json())
                .then(data => {
                    if (!data.success) {
                        throw new Error(data.error || "Could not delete group.");
                    }
                })
                .catch(err => {
                    showToast(err.message || "Could not delete group.", 'error');
                    if (originalGroup && idx !== -1) {
                        groupsList.splice(idx, 0, originalGroup);
                        renderGroupsList();
                    }
                });
        });
    }

    // Assign contacts form triggers
    const assignModal = document.getElementById('assignContactsModal');
    const assignCloseBtn = document.getElementById('assignModalCloseBtn');
    const assignCancelBtn = document.getElementById('assignModalCancelBtn');
    const assignForm = document.getElementById('assignContactsForm');
    const assignSearchInput = document.getElementById('assignSearchInput');

    if (assignForm && assignModal) {
        const closeAssign = () => assignModal.classList.remove('active');
        assignCloseBtn.addEventListener('click', closeAssign);
        assignCancelBtn.addEventListener('click', closeAssign);

        assignSearchInput.addEventListener('input', (e) => {
            renderAssignChecklist(e.target.value.toLowerCase().trim());
        });

        assignForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const groupId = document.getElementById('assignGroupId').value;
            const checkedBoxes = document.querySelectorAll('.assign-checkbox:checked');
            const contactIds = Array.from(checkedBoxes).map(box => box.value);

            const idx = groupsList.findIndex(g => g.groupId === groupId);
            if (idx === -1) return;

            const originalGroup = { ...groupsList[idx], contacts: [...(groupsList[idx].contacts || [])] };
            
            groupsList[idx].contacts = contactIds;
            renderGroupsList();
            closeAssign();
            showToast("Contacts updated in group!");

            fetch(`/api/groups/${groupId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    groupName: groupsList[idx].groupName,
                    description: groupsList[idx].description,
                    contacts: contactIds
                })
            })
            .then(res => res.json())
            .then(data => {
                if (!data.success) {
                    throw new Error("Could not update contacts in group");
                }
            })
            .catch(err => {
                showToast(err.message, 'error');
                if (idx !== -1) {
                    groupsList[idx] = originalGroup;
                    renderGroupsList();
                }
            });
        });
    }
}

function loadGroups() {
    // Load contacts first then groups to map counts
    fetch('/api/contacts')
        .then(res => res.json())
        .then(contacts => {
            allContactsForGroups = contacts;
            return fetch('/api/groups');
        })
        .then(res => res.json())
        .then(groups => {
            groupsList = groups;
            renderGroupsList();
        })
        .catch(err => console.error("Error loading groups setup", err));
}

function renderGroupsList() {
    const grid = document.getElementById('groupsGrid');
    if (!grid) return;
    grid.innerHTML = '';

    if (groupsList.length === 0) {
        grid.innerHTML = `<div class="widget-empty-state">No contact groups created yet. Click 'Create Group' to get started!</div>`;
        return;
    }

    groupsList.forEach(g => {
        const card = document.createElement('div');
        card.className = 'group-card';
        card.setAttribute('data-group-id', g.groupId);

        const assignedCount = g.contacts ? g.contacts.length : 0;

        card.innerHTML = `
            <div class="group-card-top">
                <div class="group-title-info">
                    <span class="group-card-name">${g.groupName}</span>
                    <span class="group-card-desc">${g.description || 'No description provided.'}</span>
                </div>
            </div>
            
            <div class="group-contacts-indicator">
                <i data-lucide="users"></i>
                <span>${assignedCount} connections assigned</span>
            </div>

            <div class="group-card-footer">
                <button class="primary-btn-sm" style="flex: 1; justify-content: center;" onclick="openAssignContactsModal('${g.groupId}')">
                    <i data-lucide="user-plus"></i>
                    <span>Assign Contacts</span>
                </button>
                <button class="secondary-btn" style="padding: 8px 12px;" onclick="openEditGroup('${g.groupId}')" aria-label="Edit Group">
                    <i data-lucide="edit"></i>
                </button>
                <button class="danger-btn" style="padding: 8px 12px; background: transparent; border: 1px solid var(--border-color); color: var(--danger);" onclick="confirmDeleteGroup('${g.groupId}', '${g.groupName}')" aria-label="Delete Group">
                    <i data-lucide="trash-2"></i>
                </button>
            </div>
        `;
        grid.appendChild(card);
    });

    lucide.createIcons();
}

function openEditGroup(id) {
    const g = groupsList.find(group => group.groupId === id);
    if (!g) return;

    document.getElementById('gGroupId').value = g.groupId;
    document.getElementById('gGroupName').value = g.groupName;
    document.getElementById('gDescription').value = g.description || '';

    document.getElementById('groupModalTitle').textContent = "Edit Contact Group";
    document.getElementById('groupModalSaveBtn').textContent = "Update Group";
    document.getElementById('groupModal').classList.add('active');
}

function confirmDeleteGroup(id, name) {
    const modal = document.getElementById('deleteGroupConfirmModal');
    document.getElementById('deleteGroupName').textContent = name;
    document.getElementById('deleteGroupModalConfirmBtn').dataset.groupId = id;
    modal.classList.add('active');
}

let activeAssignGroupId = '';

function openAssignContactsModal(groupId) {
    const group = groupsList.find(g => g.groupId === groupId);
    if (!group) return;

    activeAssignGroupId = groupId;
    document.getElementById('assignGroupId').value = groupId;
    document.getElementById('assignModalSubtitle').textContent = `Group: ${group.groupName}`;
    document.getElementById('assignSearchInput').value = '';

    renderAssignChecklist();

    document.getElementById('assignContactsModal').classList.add('active');
}

function renderAssignChecklist(searchQuery = '') {
    const list = document.getElementById('assignChecklist');
    if (!list) return;
    list.innerHTML = '';

    const group = groupsList.find(g => g.groupId === activeAssignGroupId);
    if (!group) return;

    const assignedIds = new Set(group.contacts || []);

    const filteredContacts = allContactsForGroups.filter(c => {
        if (searchQuery) {
            const name = `${c.firstName} ${c.lastName || ''}`.toLowerCase();
            return name.includes(searchQuery);
        }
        return true;
    });

    if (filteredContacts.length === 0) {
        list.innerHTML = `<div class="widget-empty-state">No contacts found.</div>`;
        return;
    }

    filteredContacts.forEach(c => {
        const item = document.createElement('label');
        item.className = 'assign-checklist-item';
        
        const isChecked = assignedIds.has(c.contactId);

        item.innerHTML = `
            <input type="checkbox" class="assign-checkbox" value="${c.contactId}" ${isChecked ? 'checked' : ''} onchange="updateSelectedCount()">
            <img src="${c.photo || '/static/images/default-avatar.svg'}" class="table-avatar" style="width:28px; height:28px;">
            <span>${c.firstName} ${c.lastName || ''} <span class="text-muted" style="font-size:11px;">(${c.company || 'Private'})</span></span>
        `;
        list.appendChild(item);
    });

    updateSelectedCount();
}

function updateSelectedCount() {
    const checked = document.querySelectorAll('.assign-checkbox:checked').length;
    document.getElementById('assignSelectedCount').textContent = checked;
}

/* ==========================================================================
   USER PROFILE & CATEGORIES CONTROLLER
   ========================================================================== */
function initProfilePage() {
    // 1. Settings tab switcher
    const tabButtons = document.querySelectorAll('.settings-tab');
    const tabContents = document.querySelectorAll('.settings-tab-content');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            tabButtons.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const tabId = btn.dataset.tab;
            if (tabId === 'account') document.getElementById('tabContentAccount').classList.add('active');
            if (tabId === 'security') document.getElementById('tabContentSecurity').classList.add('active');
            if (tabId === 'categories') {
                document.getElementById('tabContentCategories').classList.add('active');
                loadSettingsCategories();
            }
        });
    });

    // 2. Profile photo upload preview
    const photoInput = document.getElementById('profilePhotoInput');
    const avatarImg = document.getElementById('profileAvatarImg');
    const sidebarAvatar = document.getElementById('sidebarAvatar');

    if (photoInput && avatarImg) {
        photoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    avatarImg.src = event.target.result;
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // 3. Save profile details
    const detailsForm = document.getElementById('profileDetailsForm');
    if (detailsForm) {
        detailsForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const formData = new FormData(detailsForm);
            
            toggleLoader('saveProfileBtn', true, 'Save Profile Changes');
            
            fetch('/api/profile/update', {
                method: 'POST',
                body: formData
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    showToast("Profile details updated successfully!");
                    // Update header/sidebar text dynamically
                    const name = document.getElementById('pFullName').value;
                    const sidebarName = document.getElementById('sidebarName');
                    if (sidebarName) sidebarName.textContent = name;
                    
                    // Update avatar image in sidebar and profile page dynamically
                    if (data.user && data.user.photo) {
                        const sidebarAvatar = document.getElementById('sidebarAvatar');
                        if (sidebarAvatar) sidebarAvatar.src = data.user.photo;
                        
                        const profileAvatarImg = document.getElementById('profileAvatarImg');
                        if (profileAvatarImg) profileAvatarImg.src = data.user.photo;
                    }
                } else {
                    showToast(data.error || "Update failed.", 'error');
                }
            })
            .catch(err => showToast("An error occurred.", 'error'))
            .finally(() => toggleLoader('saveProfileBtn', false, 'Save Profile Changes'));
        });
    }

    // 4. Save Security / Password
    const securityForm = document.getElementById('profileSecurityForm');
    if (securityForm) {
        securityForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const pass = document.getElementById('pPassword').value;
            const confirm = document.getElementById('pConfirmPassword').value;

            if (pass.length < 8) {
                showToast("Password must be at least 8 characters.", 'error');
                return;
            }
            if (pass !== confirm) {
                showToast("Passwords do not match.", 'error');
                return;
            }

            toggleLoader('saveSecurityBtn', true, 'Update Password');

            const payload = new FormData();
            payload.append('fullName', document.getElementById('pFullName').value);
            payload.append('email', document.getElementById('pEmail').value);
            payload.append('password', pass);

            fetch('/api/profile/update', {
                method: 'POST',
                body: payload
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    showToast("Password updated successfully!");
                    securityForm.reset();
                } else {
                    showToast(data.error || "Security update failed.", 'error');
                }
            })
            .catch(err => showToast("Security update error.", 'error'))
            .finally(() => toggleLoader('saveSecurityBtn', false, 'Update Password'));
        });
    }

    // 5. Add custom categories
    const addCatBtn = document.getElementById('addCategoryBtn');
    if (addCatBtn) {
        addCatBtn.addEventListener('click', () => {
            const input = document.getElementById('newCategoryInput');
            const val = input.value.trim();
            if (!val) return;

            fetch('/api/categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ categoryName: val })
            })
            .then(res => res.json())
            .then(categories => {
                showToast("Category added successfully!");
                input.value = '';
                renderCategoryChips(categories);
            })
            .catch(err => showToast("Could not create category tag.", 'error'));
        });
    }
}

function loadSettingsCategories() {
    fetch('/api/categories')
        .then(res => res.json())
        .then(categories => renderCategoryChips(categories))
        .catch(err => console.error("Error loading categories settings", err));
}

function renderCategoryChips(categories) {
    const list = document.getElementById('categoryChipsList');
    if (!list) return;
    list.innerHTML = '';

    categories.forEach(cat => {
        const chip = document.createElement('div');
        chip.className = 'cat-chip';
        chip.innerHTML = `
            <div class="cat-chip-dot"></div>
            <span>${cat}</span>
        `;
        list.appendChild(chip);
    });
}
