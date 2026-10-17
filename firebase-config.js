// --- Client portal sign-in settings ---
// Shared by login.html and index.html.
//
// 1. Firebase (phone number sign-in): Firebase console > Project settings > General >
//    "Your apps" > Web app > SDK setup and configuration > Config. Paste the values below.
//    These values are public by design; your data is protected by the Apps Script check.
export const firebaseConfig = {
    apiKey: 'AIzaSyDdwjGBP5ZwdtZhlq8wsLHbgn2UwfYKDrQ',
    authDomain: 'andrew-marth-portal.firebaseapp.com',
    projectId: 'andrew-marth-portal',
    appId: '1:1067689166695:web:d315fcf943f7b8430991c2',
};

// 2. Client data: the Web app URL from deploying apps-script/portal-api.gs
//    (Deploy > New deployment > Web app). Leave empty to show the placeholder.
export const PORTAL_API_URL = '';

// True once the Firebase values above have been filled in
export const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.appId);

// Client ID = phone number without the country code, symbols or spaces (e.g. 4805551234)
export function phoneToId(phoneNumber) {
    const digits = String(phoneNumber || '').replace(/\D/g, '');
    return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

// Firebase SDK (pinned version, loaded from Google)
export const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
