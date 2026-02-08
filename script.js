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

        // Update counter
        battlesCompleted++;
        document.getElementById('battle-count').textContent = battlesCompleted;

        // Visual feedback
        const card = document.getElementById(`song-${side}`);
        card.classList.add('voted');
        setTimeout(() => card.classList.remove('voted'), 300);

        // Load next battle
        stopBoth();
        setTimeout(loadNextBattle, 800);

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
