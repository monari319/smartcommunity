// --- Supabase Client ---
const SUPABASE_URL = 'https://ombmscbaavdsmulbxmxg.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_MJR1fuH80JeYUjq8149iFQ_v818TjGZ';
const supabaseClient = window.supabase?.createClient && !SUPABASE_PUBLISHABLE_KEY.startsWith('PASTE_')
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;
let currentUser = null;
const heroSlides = [
  'https://images.unsplash.com/photo-1472396961693-142e6e269027?auto=format&fit=crop&w=2400&q=85',
  'https://images.unsplash.com/photo-1497250681960-ef046c08a56e?auto=format&fit=crop&w=2400&q=85',
  'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=2400&q=85',
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=2400&q=85',
  'https://images.unsplash.com/photo-1437482078695-73f5ca6c96e2?auto=format&fit=crop&w=2400&q=85',
  'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=2400&q=85',
  'https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=2400&q=85'
];
let heroSlideIndex = 0;
let heroSlideshowTimer = null;

let mockUsers = [];
let mockReports = [];
let reportCameraStream = null;
let reportMediaRecorder = null;
let reportVideoChunks = [];
let reportEvidenceFile = null;
let reportEvidencePreviewUrl = null;

// --- Core Navigation ---
function switchView(viewName) {
  if (viewName !== 'auth' && !currentUser) viewName = 'auth';
  if (viewName === 'admin' && currentUser?.role !== 'admin') viewName = 'resident';

  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(el => el.classList.remove('active'));

  document.getElementById(`view-${viewName}`).classList.add('active');
  const activeNavButton = document.getElementById(`nav-${viewName}`);
  if (activeNavButton) activeNavButton.classList.add('active');

  document.getElementById('nav-resident').hidden = !currentUser || currentUser.role === 'admin';
  document.getElementById('nav-admin').hidden = currentUser?.role !== 'admin';
  document.getElementById('nav-logout').hidden = !currentUser;

  if (viewName === 'resident') renderResidentDashboard();
  if (viewName === 'admin') renderAdminDashboard();
}

function showAuthForm(formName) {
  const isRegister = formName === 'register';
  stopHeroSlideshow();
  document.getElementById('auth-welcome').hidden = true;
  document.getElementById('auth-forms').hidden = false;
  document.getElementById('register-panel').hidden = !isRegister;
  document.getElementById('login-panel').hidden = isRegister;
}

function showAuthWelcome() {
  document.getElementById('auth-welcome').hidden = false;
  document.getElementById('auth-forms').hidden = true;
  document.getElementById('register-panel').hidden = true;
  document.getElementById('login-panel').hidden = true;
  startHeroSlideshow();
}

function startHeroSlideshow() {
  if (heroSlideshowTimer || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  heroSlideshowTimer = window.setInterval(() => {
    const primaryImage = document.getElementById('hero-image-primary');
    const secondaryImage = document.getElementById('hero-image-secondary');
    const currentImage = primaryImage.classList.contains('is-visible') ? primaryImage : secondaryImage;
    const nextImage = currentImage === primaryImage ? secondaryImage : primaryImage;

    nextImage.onload = () => {
      nextImage.classList.add('is-visible');
      currentImage.classList.remove('is-visible');
    };
    nextImage.src = heroSlides[heroSlideIndex];
    heroSlideIndex = (heroSlideIndex + 1) % heroSlides.length;
  }, 7000);
}

function stopHeroSlideshow() {
  window.clearInterval(heroSlideshowTimer);
  heroSlideshowTimer = null;
}

function getSupabaseErrorMessage(error) {
  const message = error?.message || String(error);
  if (/invalid api key|no api key/i.test(message)) {
    return 'Supabase rejected the project key. Replace SUPABASE_PUBLISHABLE_KEY in script.js with the current Publishable key from Project Settings > API Keys, and make sure it belongs to the configured project URL.';
  }
  if (/row.level security|permission denied|not allowed/i.test(message)) {
    return 'Supabase denied this operation. Apply the policies in supabase/schema.sql and confirm the signed-in user has permission.';
  }
  if (/relation .* does not exist|table .* not found/i.test(message)) {
    return 'The Supabase table is missing. Apply supabase/schema.sql in the Supabase SQL Editor.';
  }
  if (/database error saving new user/i.test(message)) {
    return 'Supabase could not create the account because its profile trigger failed. Run supabase/fix-registration-trigger.sql in the Supabase SQL Editor, then try again. If it still fails, check the Supabase Postgres logs for the underlying database error.';
  }
  return message;
}

// --- Resident Logic ---
async function handleReportSubmit(e) {
  e.preventDefault();
  if (!supabaseClient || !currentUser) {
    alert('Please sign in and set SUPABASE_PUBLISHABLE_KEY at the top of script.js to your current Supabase Publishable key.');
    return;
  }

  const form = document.getElementById('report-form');
  const submitButton = form.querySelector('[type="submit"]');
  if (reportMediaRecorder?.state === 'recording') {
    alert('Stop the video recording before submitting the report.');
    return;
  }
  const evidenceFile = reportEvidenceFile || document.getElementById('rep-photo').files[0];
  if (!evidenceFile) {
    alert('Add a photo or video as evidence before submitting the report.');
    document.getElementById('video-upload-button').focus();
    return;
  }
  const coordinates = document.getElementById('rep-coords').value.trim();
  let latitude = null;
  let longitude = null;

  if (coordinates) {
    const parsedCoordinates = coordinates.split(',').map(value => Number(value.trim()));
    if (parsedCoordinates.length !== 2 || parsedCoordinates.some(value => !Number.isFinite(value))) {
      alert('Enter GPS coordinates as latitude, longitude.');
      return;
    }
    [latitude, longitude] = parsedCoordinates;
  }

  submitButton.disabled = true;
  try {
    let evidenceUrl = null;
    if (evidenceFile) {
      const safeName = evidenceFile.name.replace(/[^\w.-]/g, '_');
      const filePath = `${currentUser.id}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabaseClient.storage
        .from('report-images')
        .upload(filePath, evidenceFile, { contentType: evidenceFile.type });
      if (uploadError) throw uploadError;
      evidenceUrl = supabaseClient.storage.from('report-images').getPublicUrl(filePath).data.publicUrl;
    }

    const { data, error } = await supabaseClient.from('reports').insert({
      user_id: currentUser.id,
      title: document.getElementById('rep-title').value.trim(),
      category: document.getElementById('rep-category').value,
      location: document.getElementById('rep-location').value.trim(),
      latitude,
      longitude,
      description: document.getElementById('rep-desc').value.trim(),
      image_url: evidenceUrl
    }).select().single();
    if (error) throw error;

    mockReports.unshift({ ...data, userEmail: currentUser.email });
    form.reset();
    resetReportEvidence();
    renderResidentDashboard();
    alert('Report saved successfully.');
  } catch (error) {
    console.error('Report submission failed:', error);
    alert(`Report could not be saved: ${getSupabaseErrorMessage(error)}`);
  } finally {
    submitButton.disabled = false;
  }
}

function setReportEvidence(file) {
  reportEvidenceFile = file;
  if (reportEvidencePreviewUrl) URL.revokeObjectURL(reportEvidencePreviewUrl);
  reportEvidencePreviewUrl = URL.createObjectURL(file);

  const isVideo = file.type.startsWith('video/');
  const preview = document.getElementById('evidence-preview');
  const imagePreview = document.getElementById('evidence-image-preview');
  const videoPreview = document.getElementById('evidence-video-preview');
  preview.hidden = false;
  imagePreview.hidden = isVideo;
  videoPreview.hidden = !isVideo;
  if (isVideo) videoPreview.src = reportEvidencePreviewUrl;
  else imagePreview.src = reportEvidencePreviewUrl;
  document.getElementById('evidence-status').textContent = `Evidence ready: ${file.name}`;
}

async function openReportCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    document.getElementById('evidence-status').textContent = 'Camera access is unavailable. Use HTTPS or localhost, or choose a file instead.';
    return;
  }

  try {
    reportCameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' } }
    });
    document.getElementById('camera-feed').srcObject = reportCameraStream;
    document.getElementById('camera-panel').hidden = false;
    document.getElementById('evidence-status').textContent = 'Camera is ready. Take a photo or record a video.';
  } catch (error) {
    console.error('Camera access failed:', error);
    document.getElementById('evidence-status').textContent = 'Camera access was blocked or unavailable. Check browser permissions, or choose a file instead.';
  }
}

async function captureReportPhoto() {
  const feed = document.getElementById('camera-feed');
  if (!feed.videoWidth || !feed.videoHeight) {
    document.getElementById('evidence-status').textContent = 'Wait for the camera preview before taking a photo.';
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = feed.videoWidth;
  canvas.height = feed.videoHeight;
  canvas.getContext('2d').drawImage(feed, 0, 0);
  const photoBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!photoBlob) {
    document.getElementById('evidence-status').textContent = 'The photo could not be captured. Please try again.';
    return;
  }

  document.getElementById('rep-photo').value = '';
  setReportEvidence(new File([photoBlob], `report-photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
}

function startReportVideoRecording() {
  if (!reportCameraStream || !window.MediaRecorder) {
    document.getElementById('evidence-status').textContent = 'Video recording is not supported by this browser.';
    return;
  }

  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find(type => MediaRecorder.isTypeSupported(type));
  reportVideoChunks = [];
  reportMediaRecorder = new MediaRecorder(reportCameraStream, mimeType ? { mimeType } : undefined);
  reportMediaRecorder.addEventListener('dataavailable', event => {
    if (event.data.size) reportVideoChunks.push(event.data);
  });
  reportMediaRecorder.addEventListener('stop', () => {
    const type = reportMediaRecorder.mimeType || 'video/webm';
    const extension = type.includes('mp4') ? 'mp4' : 'webm';
    const video = new File(reportVideoChunks, `report-video-${Date.now()}.${extension}`, { type });
    reportVideoChunks = [];
    document.getElementById('rep-photo').value = '';
    setReportEvidence(video);
    document.getElementById('camera-record').hidden = false;
    document.getElementById('camera-stop-recording').hidden = true;
  }, { once: true });
  reportMediaRecorder.start();
  document.getElementById('camera-record').hidden = true;
  document.getElementById('camera-stop-recording').hidden = false;
  document.getElementById('evidence-status').textContent = 'Recording video. Select Stop recording when finished.';
}

function stopReportCamera() {
  if (reportMediaRecorder?.state === 'recording') reportMediaRecorder.stop();
  reportCameraStream?.getTracks().forEach(track => track.stop());
  reportCameraStream = null;
  document.getElementById('camera-feed').srcObject = null;
  document.getElementById('camera-panel').hidden = true;
}

function resetReportEvidence() {
  stopReportCamera();
  reportMediaRecorder = null;
  reportEvidenceFile = null;
  if (reportEvidencePreviewUrl) URL.revokeObjectURL(reportEvidencePreviewUrl);
  reportEvidencePreviewUrl = null;
  document.getElementById('evidence-preview').hidden = true;
  document.getElementById('evidence-image-preview').removeAttribute('src');
  document.getElementById('evidence-video-preview').removeAttribute('src');
  document.getElementById('evidence-status').textContent = '';
  document.getElementById('camera-record').hidden = false;
  document.getElementById('camera-stop-recording').hidden = true;
}

function renderResidentDashboard() {
  const myReports = mockReports.filter(report => report.user_id === currentUser.id);
  
  // Update Stats
  document.getElementById('res-stat-total').innerText = myReports.length || '';
  document.getElementById('res-stat-pending').innerText = myReports.filter(r => ['Submitted', 'Under Review', 'In Progress'].includes(r.status)).length;
  document.getElementById('res-stat-resolved').innerText = myReports.filter(r => r.status === 'Resolved').length;

  // Render Table
  const tbody = document.getElementById('resident-reports-table');
  tbody.innerHTML = myReports.map(r => `
    <tr>
      <td><strong>${r.title}</strong></td>
      <td>${r.category}</td>
      <td><span class="badge badge-${getBadgeClass(r.status)}">${r.status}</span></td>
      <td>${(r.created_at || '').slice(0, 10)}</td>
    </tr>
  `).join('') || `<tr><td colspan="4" style="text-align:center;">No reports found.</td></tr>`;
}

// --- Admin Logic ---
function renderAdminDashboard() {
  // Update Admin Statistics
  document.getElementById('admin-stat-total').innerText = mockReports.length;
  document.getElementById('admin-stat-review').innerText = mockReports.filter(r => r.status === 'Under Review').length;
  document.getElementById('admin-stat-progress').innerText = mockReports.filter(r => r.status === 'In Progress').length;
  document.getElementById('admin-stat-resolved').innerText = mockReports.filter(r => r.status === 'Resolved').length;

  renderAdminReports();
  renderResidentsDirectory();
}

function renderAdminReports() {
  const searchQuery = document.getElementById('admin-search').value.toLowerCase();
  const filterStatus = document.getElementById('admin-filter-status').value;

  const filtered = mockReports.filter(r => {
    const matchesSearch = r.title.toLowerCase().includes(searchQuery) || r.description.toLowerCase().includes(searchQuery);
    const matchesStatus = filterStatus === 'ALL' || r.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const tbody = document.getElementById('admin-reports-table');
  tbody.innerHTML = filtered.map(r => `
    <tr>
      <td><small>${r.id}</small></td>
      <td><strong>${r.title}</strong></td>
      <td>${r.category}</td>
      <td>${r.location}</td>
      <td><small>${r.userEmail}</small></td>
      <td>${r.image_url ? `<a href="${r.image_url}" target="_blank" rel="noopener noreferrer">Open evidence</a>` : '—'}</td>
      <td><span class="badge badge-${getBadgeClass(r.status)}">${r.status}</span></td>
      <td>
        <select onchange="updateReportStatus('${r.id}', this.value)">
          <option value="Submitted" ${r.status === 'Submitted' ? 'selected' : ''}>Submitted</option>
          <option value="Under Review" ${r.status === 'Under Review' ? 'selected' : ''}>Under Review</option>
          <option value="In Progress" ${r.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
          <option value="Resolved" ${r.status === 'Resolved' ? 'selected' : ''}>Resolved</option>
          <option value="Rejected" ${r.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
        </select>
      </td>
      <td>
        <button class="btn-delete" onclick="deleteReport('${r.id}')">Delete</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="9" style="text-align:center;">No matching reports found.</td></tr>`;
}

function renderResidentsDirectory() {
  const tbody = document.getElementById('admin-residents-table');
  tbody.innerHTML = mockUsers.map(u => `
    <tr>
      <td>${u.name}</td>
      <td>${u.email}</td>
      <td>${u.phone}</td>
      <td><span class="badge ${u.status === 'Verified' ? 'badge-resolved' : 'badge-review'}">${u.status}</span></td>
    </tr>
  `).join('');
}

async function fetchAllReportsForAdmin() {
  const [{ data: reports, error: reportError }, { data: profiles, error: profilesError }] = await Promise.all([
    supabaseClient.from('reports').select('*, profiles(email)').order('created_at', { ascending: false }),
    supabaseClient.from('profiles').select('name, email, phone, role').order('created_at', { ascending: false })
  ]);
  if (reportError) throw reportError;
  if (profilesError) throw profilesError;

  mockReports = reports.map(({ profiles: profile, ...report }) => ({ ...report, userEmail: profile?.email || '' }));
  mockUsers = profiles.map(profile => ({ ...profile, status: 'Verified' }));
  renderAdminDashboard();
}

async function updateReportStatus(reportId, newStatus) {
  const { error } = await supabaseClient.from('reports').update({ status: newStatus }).eq('id', reportId);
  if (error) {
    alert(`Report status could not be saved: ${error.message}`);
    return;
  }
  await fetchAllReportsForAdmin();
}

async function deleteReport(reportId) {
  if (confirm(`Are you sure you want to delete report ${reportId}?`)) {
    const { error } = await supabaseClient.from('reports').delete().eq('id', reportId);
    if (error) {
      alert(`Report could not be deleted: ${error.message}`);
      return;
    }
    await fetchAllReportsForAdmin();
  }
}

// --- Authentication Handlers ---
async function setCurrentUser(authUser) {
  const { data: profile, error } = await supabaseClient
    .from('profiles')
    .select('name, phone, role')
    .eq('id', authUser.id)
    .maybeSingle();
  if (error) throw error;

  currentUser = {
    id: authUser.id,
    name: profile?.name || authUser.user_metadata?.name || '',
    email: authUser.email,
    phone: profile?.phone || authUser.user_metadata?.phone || '',
    role: authUser.app_metadata?.role || profile?.role || 'resident'
  };
}

async function fetchUserReports() {
  const { data, error } = await supabaseClient
    .from('reports')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  mockReports = data.map(report => ({ ...report, userEmail: currentUser.email }));
}

async function handleRegister(e) {
  e.preventDefault();
  if (!supabaseClient) {
    alert('Set SUPABASE_PUBLISHABLE_KEY at the top of script.js to the current Publishable key from your Supabase project.');
    return;
  }

  const name = document.getElementById('reg-name').value;
  const email = document.getElementById('reg-email').value;
  const phone = document.getElementById('reg-phone').value;
  const password = document.getElementById('reg-pass').value;
  const confirmPassword = document.getElementById('reg-confirm-pass').value;

  if (password !== confirmPassword) {
    alert("Passwords do not match. Please confirm your password.");
    return;
  }

  const submitButton = document.querySelector('#register-form [type="submit"]');
  submitButton.disabled = true;
  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: { data: { name, phone, role: 'resident' } }
    });
    if (error) throw error;

    document.getElementById('register-form').reset();
    document.getElementById('login-email').value = email;
    showAuthForm('login');
    alert(data.session
      ? 'Registration successful. Your account details were saved.'
      : 'Registration successful. Check your email to confirm your account before logging in.');
  } catch (error) {
    console.error('Registration failed:', error);
    alert(`Registration failed: ${getSupabaseErrorMessage(error)}`);
  } finally {
    submitButton.disabled = false;
  }
}

async function handleLogin(e) {
  e.preventDefault();
  if (!supabaseClient) {
    alert('Set SUPABASE_PUBLISHABLE_KEY at the top of script.js to the current Publishable key from your Supabase project.');
    return;
  }

  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-pass').value;
  const role = document.getElementById('login-role').value;
  const submitButton = document.querySelector('#login-form [type="submit"]');
  submitButton.disabled = true;
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await setCurrentUser(data.user);
    if (currentUser.role !== role) {
      await supabaseClient.auth.signOut();
      currentUser = null;
      throw new Error('The selected role does not match this account.');
    }

    if (role === 'admin') {
      await fetchAllReportsForAdmin();
    } else {
      await fetchUserReports();
    }
    switchView(role === 'admin' ? 'admin' : 'resident');
  } catch (error) {
    console.error('Login failed:', error);
    alert(`Login failed: ${getSupabaseErrorMessage(error)}`);
  } finally {
    submitButton.disabled = false;
  }
}

async function handleLogout() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  currentUser = null;
  mockReports = [];
  showAuthWelcome();
  switchView('auth');
}

// --- Helpers ---
function getBadgeClass(status) {
  switch (status) {
    case 'Submitted': return 'submitted';
    case 'Under Review': return 'review';
    case 'In Progress': return 'progress';
    case 'Resolved': return 'resolved';
    case 'Rejected': return 'rejected';
    default: return 'submitted';
  }
}

const COMMUNITY_ASSISTANT_URL = `${SUPABASE_URL}/functions/v1/community-assistant`;
let communityAssistantHistory = [];

function addAssistantMessage(text, sender) {
  const messages = document.getElementById('assistant-messages');
  const message = document.createElement('div');
  const paragraph = document.createElement('p');
  message.className = `assistant-message assistant-message-${sender}`;
  paragraph.textContent = text;
  message.appendChild(paragraph);
  messages.appendChild(message);
  messages.scrollTop = messages.scrollHeight;
  return message;
}

function getCommunityHelpReply(question) {
  const normalizedQuestion = question.toLowerCase();

  if (/\b(my reports|my report|where is|find my|how many)\b/.test(normalizedQuestion) && currentUser) {
    const myReports = mockReports.filter(report => report.userEmail === currentUser.email);
    if (myReports.length === 0) return 'You do not have any reports in this session yet. You can submit one from the resident dashboard.';
    return `You have ${myReports.length} report${myReports.length === 1 ? '' : 's'} in this session: ${myReports.map(report => `${report.title} (${report.status})`).join('; ')}.`;
  }
  if (/\b(status(?:es)?|submitted|under review|in progress|resolved|rejected|track|progress)\b/.test(normalizedQuestion)) {
    return 'Submitted means the report has been received. Under Review means the community team is assessing it. In Progress means work is underway. Resolved means it has been addressed, and Rejected means it will not be actioned. Residents can track reports in Your submitted reports.';
  }
  if (/\b(report|submit|raise|file)\b/.test(normalizedQuestion)) {
    return 'To report an issue, log in as a resident and open the Submit a report form. Add a title, category, location, and description; a photo and GPS coordinates are optional.';
  }
  if (/\b(login|log in|account|register|sign up|password)\b/.test(normalizedQuestion)) {
    return 'Use Create an account to register as a resident, or Log in if you already have an account. If you have trouble signing in, check that the selected role matches your account.';
  }
  if (/\b(admin|administrator|dashboard)\b/.test(normalizedQuestion)) {
    return 'The admin dashboard is for administrators. It shows community reports, lets admins filter and update report statuses, and includes the residents directory.';
  }
  return 'I can help with submitting a community report, understanding report statuses, finding your reports, or using the resident and admin dashboards. Which would you like to know about?';
}

async function askCommunityAssistant(question) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(COMMUNITY_ASSISTANT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        'apikey': SUPABASE_PUBLISHABLE_KEY
      },
      body: JSON.stringify({
        messages: communityAssistantHistory.slice(-12)
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error('Assistant service is unavailable');
    const result = await response.json();
    const reply = result.reply || result.message || result.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) throw new Error('Assistant returned no reply');
    return reply.trim();
  } catch {
    return `${getCommunityHelpReply(question)}\n\nThe AI service is not connected right now, so this is a built-in portal help response.`;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function setAssistantOpen(isOpen) {
  document.getElementById('assistant-panel').hidden = !isOpen;
  document.getElementById('assistant-toggle').setAttribute('aria-expanded', String(isOpen));
  if (isOpen) document.getElementById('assistant-input').focus();
}

async function handleAssistantSubmit(event) {
  event.preventDefault();
  const input = document.getElementById('assistant-input');
  const sendButton = document.getElementById('assistant-send');
  const question = input.value.trim();
  if (!question || sendButton.disabled) return;

  addAssistantMessage(question, 'user');
  communityAssistantHistory.push({ role: 'user', content: question });
  input.value = '';
  sendButton.disabled = true;
  const pendingMessage = addAssistantMessage('Thinking...', 'bot assistant-message-pending');
  const reply = await askCommunityAssistant(question);
  pendingMessage.remove();
  addAssistantMessage(reply, 'bot');
  communityAssistantHistory.push({ role: 'assistant', content: reply });
  sendButton.disabled = false;
  input.focus();
}

document.addEventListener('DOMContentLoaded', () => {
  const assistantForm = document.getElementById('assistant-form');
  const assistantToggle = document.getElementById('assistant-toggle');
  const assistantClose = document.getElementById('assistant-close');

  assistantForm.addEventListener('submit', handleAssistantSubmit);
  document.getElementById('camera-open').addEventListener('click', openReportCamera);
  document.getElementById('video-upload-button').addEventListener('click', () => {
    document.getElementById('rep-video').click();
  });
  document.getElementById('rep-video').addEventListener('change', event => {
    const file = event.target.files[0];
    if (file) setReportEvidence(file);
    event.target.value = '';
  });
  document.getElementById('camera-photo').addEventListener('click', captureReportPhoto);
  document.getElementById('camera-record').addEventListener('click', startReportVideoRecording);
  document.getElementById('camera-stop-recording').addEventListener('click', () => reportMediaRecorder?.stop());
  document.getElementById('camera-close').addEventListener('click', stopReportCamera);
  document.getElementById('rep-photo').addEventListener('change', event => {
    const file = event.target.files[0];
    if (file) setReportEvidence(file);
    else resetReportEvidence();
  });
  assistantToggle.addEventListener('click', () => setAssistantOpen(true));
  assistantClose.addEventListener('click', () => {
    setAssistantOpen(false);
    assistantToggle.focus();
  });
  document.querySelectorAll('[data-assistant-prompt]').forEach(button => {
    button.addEventListener('click', () => {
      document.getElementById('assistant-input').value = button.dataset.assistantPrompt;
      assistantForm.requestSubmit();
    });
  });
});

// Initialize View on Page Load
document.addEventListener("DOMContentLoaded", () => {
  switchView('auth');
  startHeroSlideshow();
  if (supabaseClient) {
    supabaseClient.auth.getSession().then(async ({ data, error }) => {
      if (error) throw error;
      if (!data.session) return;
      await setCurrentUser(data.session.user);
      if (currentUser.role === 'admin') {
        await fetchAllReportsForAdmin();
        switchView('admin');
      } else {
        await fetchUserReports();
        switchView('resident');
      }
    }).catch(error => console.error('Could not restore Supabase session:', error));
  }
});

/*

// Initialize Supabase Client
const SUPABASE_URL = 'https://ombmscbaavdsmulbxmxg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tYm1zY2JhYXZkc211bGJ4bXhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2OTIwNTAsImV4cCI6MjEwNjI2ODA1MH0.XItxECKcDeLZAeiQistVdMgqrDRiW1U20AKvC48YY-g';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 1. Resident Registration
async function registerResident(email, password, fullName, phone) {
    const { data, error } = await supabase.auth.signUp({
        email: email,
        password: password,

      const COMMUNITY_ASSISTANT_URL = 'https://ombmscbaavdsmulbxmxg.supabase.co/functions/v1/community-assistant';
      const COMMUNITY_ASSISTANT_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhbGciOiJIUzI1NiIsInJlZiI6Im9tYm1zY2JhYXZkc211bGJ4bXhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2OTIwNTAsImV4cCI6MjEwNjI2ODA1MH0.XItxECKcDeLZAeiQistVdMgqrDRiW1U20AKvC48YY-g';

      function addAssistantMessage(text, sender) {
        const messages = document.getElementById('assistant-messages');
        const message = document.createElement('div');
        const paragraph = document.createElement('p');
        message.className = `assistant-message assistant-message-${sender}`;
        paragraph.textContent = text;
        message.appendChild(paragraph);
        messages.appendChild(message);
        messages.scrollTop = messages.scrollHeight;
        return message;
      }

      function getCommunityHelpReply(question) {
        const normalizedQuestion = question.toLowerCase();

        if (/\b(report|submit|raise|file)\b/.test(normalizedQuestion)) {
          return 'To report an issue, log in as a resident and open the Submit a report form. Add a short title, category, location, and description; a photo and GPS coordinates are optional. Select Submit Report when you are ready.';
        }

        if (/\b(status|submitted|under review|in progress|resolved|rejected|track|progress)\b/.test(normalizedQuestion)) {
          return 'Submitted means the report has been received. Under Review means the community team is assessing it. In Progress means work is underway. Resolved means it has been addressed, and Rejected means it will not be actioned. Residents can track reports in Your submitted reports.';
        }

        if (/\b(my reports|my report|where is|find my|how many)\b/.test(normalizedQuestion) && currentUser) {
          const myReports = mockReports.filter(report => report.userEmail === currentUser.email);
          if (myReports.length === 0) return 'You do not have any reports in this session yet. You can submit one from the resident dashboard.';
          return `You have ${myReports.length} report${myReports.length === 1 ? '' : 's'} in this session: ${myReports.map(report => `${report.title} (${report.status})`).join('; ')}.`;
        }

        if (/\b(login|log in|account|register|sign up|password)\b/.test(normalizedQuestion)) {
          return 'Use Create an account to register as a resident, or Log in if you already have an account. If you have trouble signing in, check that the selected role matches your account.';
        }

        if (/\b(admin|administrator|dashboard)\b/.test(normalizedQuestion)) {
          return 'The admin dashboard is for administrators. It shows community reports, lets admins filter and update report statuses, and includes the residents directory.';
        }

        return 'I can help with submitting a community report, understanding report statuses, finding your reports, or using the resident and admin dashboards. Which would you like to know about?';
      }

      async function askCommunityAssistant(question) {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 12000);

        try {
          const response = await fetch(COMMUNITY_ASSISTANT_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${COMMUNITY_ASSISTANT_ANON_KEY}`,
              'apikey': COMMUNITY_ASSISTANT_ANON_KEY
            },
            body: JSON.stringify({
              messages: [{ role: 'user', content: question }],
              context: 'You are the helpful assistant for a community issue reporting portal. Give concise, practical answers about community reporting and portal navigation.'
            }),
            signal: controller.signal
          });

          if (!response.ok) throw new Error('Assistant service is unavailable');
          const result = await response.json();
          const reply = result.reply || result.message || result.choices?.[0]?.message?.content;
          if (typeof reply !== 'string' || !reply.trim()) throw new Error('Assistant returned no reply');
          return reply.trim();
        } catch {
          return `${getCommunityHelpReply(question)}\n\nThe AI service is not connected right now, so this is a built-in portal help response.`;
        } finally {
          window.clearTimeout(timeoutId);
        }
      }

      function setAssistantOpen(isOpen) {
        document.getElementById('assistant-panel').hidden = !isOpen;
        document.getElementById('assistant-toggle').setAttribute('aria-expanded', String(isOpen));
        if (isOpen) document.getElementById('assistant-input').focus();
      }

      async function handleAssistantSubmit(event) {
        event.preventDefault();
        const input = document.getElementById('assistant-input');
        const sendButton = document.getElementById('assistant-send');
        const question = input.value.trim();
        if (!question || sendButton.disabled) return;

        addAssistantMessage(question, 'user');
        input.value = '';
        sendButton.disabled = true;
        const pendingMessage = addAssistantMessage('Thinking...', 'bot assistant-message-pending');

        const reply = await askCommunityAssistant(question);
        pendingMessage.remove();
        addAssistantMessage(reply, 'bot');
        sendButton.disabled = false;
        input.focus();
      }

      document.addEventListener('DOMContentLoaded', () => {
        const assistantForm = document.getElementById('assistant-form');
        const assistantToggle = document.getElementById('assistant-toggle');
        const assistantClose = document.getElementById('assistant-close');

        assistantForm.addEventListener('submit', handleAssistantSubmit);
        assistantToggle.addEventListener('click', () => setAssistantOpen(true));
        assistantClose.addEventListener('click', () => assistantToggle.focus() || setAssistantOpen(false));
        document.querySelectorAll('[data-assistant-prompt]').forEach(button => {
          button.addEventListener('click', () => {
            document.getElementById('assistant-input').value = button.dataset.assistantPrompt;
            assistantForm.requestSubmit();
          });
        });
      });
        options: {
            data: {
                name: fullName,
                phone: phone,
                role: 'resident'
            }
*/