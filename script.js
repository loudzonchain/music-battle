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
// YOUTUBE API
// ============================================

function onYouTubeIframeAPIReady() {
    console.log('YouTube API Ready!');
    loadNextBattle();
}

function createPlayer(elementId, song) {
    return new YT.Player(elementId, {
        height: '100%',
        width: '100%',
        videoId: song.youtube_id,  // Note: API uses snake_case
        playerVars: {
            'start': song.start_time,
            'autoplay': 0,
            'controls': 1,
            'rel': 0,
            'modestbranding': 1,
            'playsinline': 1  // Better for mobile
        }
    });
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

        // Destroy old players
        if (playerLeft) playerLeft.destroy();
        if (playerRight) playerRight.destroy();

        // Create new players
        playerLeft = createPlayer('player-left', currentBattle.left);
        playerRight = createPlayer('player-right', currentBattle.right);

        // Update display
        updateSongInfo();

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
    if (playerLeft && playerRight) {
        playerLeft.playVideo();
        playerRight.playVideo();
    }
}

function stopBoth() {
    if (playerLeft && playerRight) {
        playerLeft.stopVideo();
        playerRight.stopVideo();
    }
}

// ============================================
// VOTING - Now saves to database!
// ============================================

async function vote(side) {
    const winner = currentBattle[side];
    const loser = currentBattle[side === 'left' ? 'right' : 'left'];
    const loserSide = side === 'left' ? 'right' : 'left';

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

        // Winner celebration effect
        const winnerCard = document.getElementById(`song-${side}`);
        const loserCard = document.getElementById(`song-${loserSide}`);

        winnerCard.classList.add('winner');
        loserCard.style.opacity = '0.5';

        setTimeout(() => {
            winnerCard.classList.remove('winner');
            loserCard.style.opacity = '1';
        }, 600);

        // Stop videos and load next battle
        stopBoth();
        setTimeout(loadNextBattle, 1000);

    } catch (error) {
        console.error('Failed to submit vote:', error);
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
