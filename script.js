/*
  SCRIPT.JS - Music Battle with Backend API
  Now votes are saved to a real database!
*/

// ============================================
// API URL - Where our backend lives
// Uses current domain (works for localhost AND production)
// ============================================
const API_URL = window.location.origin + '/api';

// ============================================
// STATE
// ============================================

let currentBattle = {
    left: null,
    right: null
};

let playerLeft = null;
let playerRight = null;
let battlesCompleted = 0;

// ============================================
// YOUTUBE API — Thumbnail-first lazy loading
// ============================================

function onYouTubeIframeAPIReady() {
    console.log('YouTube API Ready!');
    loadNextBattle();
}

// Show a YouTube thumbnail with a play button overlay
function showThumbnail(side) {
    const song = currentBattle[side];
    const container = document.querySelector('#song-' + side + ' .video-container');
    container.innerHTML =
        '<div class="video-thumb-wrapper" onclick="loadPlayer(\'' + side + '\')">' +
            '<img src="https://img.youtube.com/vi/' + song.youtube_id + '/hqdefault.jpg" alt="' + song.title + '">' +
            '<div class="thumb-play-btn">\u25B6</div>' +
        '</div>';
}

// Load the actual YouTube iframe when user clicks play
function loadPlayer(side) {
    const song = currentBattle[side];
    const container = document.querySelector('#song-' + side + ' .video-container');

    // Replace thumbnail with a fresh div for YT.Player
    container.innerHTML = '<div id="yt-' + side + '"></div>';

    var player = new YT.Player('yt-' + side, {
        height: '100%',
        width: '100%',
        videoId: song.youtube_id,
        playerVars: {
            'start': song.start_time,
            'autoplay': 1,
            'controls': 1,
            'rel': 0,
            'modestbranding': 1,
            'playsinline': 1
        }
    });

    if (side === 'left') playerLeft = player;
    else playerRight = player;
}

// ============================================
// BATTLE FUNCTIONS
// ============================================

// Fetch a new battle from the backend
async function loadNextBattle() {
    try {
        const response = await fetch(`${API_URL}/battle`);
        const battle = await response.json();

        currentBattle = battle;

        // Reset players (thumbnails replace old content)
        playerLeft = null;
        playerRight = null;

        // Get card elements
        const leftCard = document.getElementById('song-left');
        const rightCard = document.getElementById('song-right');

        // Remove any leftover animation classes
        leftCard.classList.remove('slide-in-left', 'slide-out-left', 'winner');
        rightCard.classList.remove('slide-in-right', 'slide-out-right', 'winner');

        // Show thumbnails instead of loading full iframes
        showThumbnail('left');
        showThumbnail('right');

        // Update song titles and artists
        updateSongInfo();

        // Add slide-in animations for the new cards
        leftCard.classList.add('slide-in-left');
        rightCard.classList.add('slide-in-right');

        // Re-enable vote buttons
        document.querySelectorAll('.vote-btn').forEach(btn => btn.disabled = false);

        console.log('New battle:', currentBattle.left.title, 'vs', currentBattle.right.title);
    } catch (error) {
        console.error('Failed to load battle:', error);
    }
}

function updateSongInfo() {
    const leftCard = document.getElementById('song-left');
    const rightCard = document.getElementById('song-right');

    leftCard.querySelector('.song-title').textContent = currentBattle.left.title;
    leftCard.querySelector('.artist-name').textContent = currentBattle.left.artist;

    rightCard.querySelector('.song-title').textContent = currentBattle.right.title;
    rightCard.querySelector('.artist-name').textContent = currentBattle.right.artist;
}

// ============================================
// PLAYBACK
// ============================================

function playBoth() {
    // Load players if still showing thumbnails
    if (!playerLeft) loadPlayer('left');
    if (!playerRight) loadPlayer('right');

    // If already loaded, play them
    if (playerLeft && typeof playerLeft.playVideo === 'function') playerLeft.playVideo();
    if (playerRight && typeof playerRight.playVideo === 'function') playerRight.playVideo();
}

function stopBoth() {
    if (playerLeft && typeof playerLeft.stopVideo === 'function') playerLeft.stopVideo();
    if (playerRight && typeof playerRight.stopVideo === 'function') playerRight.stopVideo();
}

// ============================================
// VOTING - Now saves to database!
// ============================================

async function vote(side) {
    const winner = currentBattle[side];
    const loser = currentBattle[side === 'left' ? 'right' : 'left'];
    const loserSide = side === 'left' ? 'right' : 'left';

    // Disable vote buttons so you can't double-click
    document.querySelectorAll('.vote-btn').forEach(btn => btn.disabled = true);

    try {
        // Send vote to backend
        const response = await fetch(`${API_URL}/vote`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                winnerId: winner.id,
                loserId: loser.id
            })
        });

        const result = await response.json();
        console.log(result.message, `(${result.newVoteCount} total votes)`);

        // Update counter with animation
        battlesCompleted++;
        const counter = document.getElementById('battle-count');
        counter.style.transform = 'scale(1.3)';
        counter.textContent = battlesCompleted;
        setTimeout(() => counter.style.transform = 'scale(1)', 200);

        // Sync footer counter
        const footerCount = document.getElementById('footer-battle-count');
        if (footerCount) footerCount.textContent = battlesCompleted;

        // Prompt username after first vote if not set
        if (!localStorage.getItem('musicbattle_username') && !localStorage.getItem('musicbattle_username_prompted')) {
            localStorage.setItem('musicbattle_username_prompted', 'true');
            setTimeout(function() {
                document.querySelector('.modal-body h2').textContent = 'Nice vote!';
                document.querySelector('.modal-subtitle').textContent = 'Set a username to track your battles';
                showUsernameModal();
            }, 3200);
        }

        // Get both cards
        const winnerCard = document.getElementById(`song-${side}`);
        const loserCard = document.getElementById(`song-${loserSide}`);

        // Step 1: Loser slides off screen, winner glows
        winnerCard.classList.add('winner');
        loserCard.classList.add(loserSide === 'left' ? 'slide-out-left' : 'slide-out-right');

        // Step 2: Flash vote count on the winner card
        const voteFlash = document.createElement('div');
        voteFlash.className = 'vote-count-flash';
        voteFlash.textContent = `${result.newVoteCount} votes`;
        winnerCard.appendChild(voteFlash);

        // Step 2b: Matrix rain burst around the winner card
        spawnRainBurst(winnerCard);

        // Step 2c: Change winner's vote button to confirmed state
        var winnerBtn = winnerCard.querySelector('.vote-btn');
        if (winnerBtn) {
            winnerBtn.textContent = '\u2713 Winner';
            winnerBtn.classList.add('confirmed');
        }

        // Step 2d: Show save button on winner card
        addSaveButton(winnerCard, winner.id);

        // Stop videos
        stopBoth();

        // Step 3: After 3s, load next battle (extended for save window)
        setTimeout(() => {
            // Clean up animation classes, vote flash, and save button
            winnerCard.classList.remove('winner');
            loserCard.classList.remove('slide-out-left', 'slide-out-right');
            loserCard.style.opacity = '1';
            if (voteFlash.parentNode) voteFlash.remove();
            var saveBtn = winnerCard.querySelector('.save-btn');
            if (saveBtn) saveBtn.remove();
            if (winnerBtn) {
                winnerBtn.textContent = 'This One Wins';
                winnerBtn.classList.remove('confirmed');
            }

            // Load next battle (slide-in happens in loadNextBattle)
            loadNextBattle();
        }, 3000);

    } catch (error) {
        console.error('Failed to submit vote:', error);
        // Re-enable buttons if something goes wrong
        document.querySelectorAll('.vote-btn').forEach(btn => btn.disabled = false);
    }
}

// ============================================
// SAVE TO PLAYLIST
// ============================================

async function addSaveButton(card, songId) {
    // Check if song is already in playlist
    var alreadySaved = false;
    try {
        var checkRes = await fetch(API_URL + '/playlist/check/' + songId);
        var checkData = await checkRes.json();
        alreadySaved = checkData.saved;
    } catch (e) {
        console.error('Failed to check playlist:', e);
    }

    var btn = document.createElement('button');
    btn.className = 'save-btn' + (alreadySaved ? ' saved' : '');
    btn.textContent = alreadySaved ? '\u2713 Saved' : '\u266b Save';

    if (!alreadySaved) {
        btn.onclick = function() {
            saveSong(songId, btn);
        };
    }

    // Insert after song-info, before vote button
    var songInfo = card.querySelector('.song-info');
    if (songInfo) {
        songInfo.after(btn);
    } else {
        card.appendChild(btn);
    }
}

async function saveSong(songId, btn) {
    try {
        var res = await fetch(API_URL + '/playlist/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ songId: songId })
        });
        var data = await res.json();

        if (data.success) {
            btn.textContent = '\u2713 Saved';
            btn.classList.add('saved');
            btn.onclick = null;
            showToast(data.youtube
                ? 'Added to playlist & YouTube \u2713'
                : 'Added to your playlist \u2713');
        }
    } catch (e) {
        console.error('Failed to save song:', e);
    }
}

// ============================================
// TOAST NOTIFICATIONS
// ============================================

function showToast(message) {
    // Remove any existing toast
    var existing = document.querySelector('.toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    // Auto-dismiss after 2 seconds
    setTimeout(function() {
        toast.classList.add('dismiss');
        setTimeout(function() {
            if (toast.parentNode) toast.remove();
        }, 300);
    }, 2000);
}

// Matrix rain burst effect on winner card
function spawnRainBurst(card) {
    const burstChars = '\u266a\u266b\u266c\u266901'.split('');
    const rect = card.getBoundingClientRect();
    const count = 20;

    for (let i = 0; i < count; i++) {
        const el = document.createElement('div');
        el.className = 'rain-burst-char';
        el.textContent = burstChars[Math.floor(Math.random() * burstChars.length)];

        // Random position across the card width
        const left = Math.random() * 100;
        const top = Math.random() * 30;  // Start near the top
        const delay = Math.random() * 0.4;
        const duration = 0.8 + Math.random() * 0.6;

        el.style.left = left + '%';
        el.style.top = top + '%';
        el.style.animationDelay = delay + 's';
        el.style.animationDuration = duration + 's';
        el.style.fontSize = (10 + Math.random() * 8) + 'px';

        card.appendChild(el);

        // Clean up after animation
        setTimeout(function() {
            if (el.parentNode) el.remove();
        }, (delay + duration) * 1000 + 100);
    }
}

function skip() {
    stopBoth();
    loadNextBattle();
}

// ============================================
// STATS - Load from backend
// ============================================

async function loadStats() {
    try {
        const response = await fetch(`${API_URL}/stats`);
        const stats = await response.json();

        battlesCompleted = stats.totalBattles;
        document.getElementById('battle-count').textContent = battlesCompleted;

        // Sync footer counter
        const footerCount = document.getElementById('footer-battle-count');
        if (footerCount) footerCount.textContent = battlesCompleted;

        console.log('Stats loaded:', stats);
    } catch (error) {
        console.error('Failed to load stats:', error);
    }
}

// Load stats when page loads
loadStats();

// ============================================
// SIMPLE USERNAME (no password needed)
// ============================================

let username = localStorage.getItem('musicbattle_username');

function checkUsername() {
    if (username) {
        showLoggedInView();
    } else {
        showLoggedOutView();
    }
}

function showLoggedInView() {
    document.getElementById('logged-out-view').style.display = 'none';
    document.getElementById('logged-in-view').style.display = 'flex';
    document.getElementById('display-username').textContent = username;
}

function showLoggedOutView() {
    document.getElementById('logged-out-view').style.display = 'flex';
    document.getElementById('logged-in-view').style.display = 'none';
}

function showUsernameModal() {
    document.getElementById('username-modal').style.display = 'flex';
    document.getElementById('username-input').value = '';
    document.getElementById('username-input').focus();
}

function hideUsernameModal() {
    document.getElementById('username-modal').style.display = 'none';
}

function saveUsername() {
    const input = document.getElementById('username-input').value.trim();
    if (input.length < 2) {
        alert('Username must be at least 2 characters');
        return;
    }
    username = input;
    localStorage.setItem('musicbattle_username', username);
    showLoggedInView();
    hideUsernameModal();
}

function changeUsername() {
    showUsernameModal();
    document.getElementById('username-input').value = username;
}

// Check username on page load
checkUsername();
