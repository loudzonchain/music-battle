/*
  ELO.JS - Elo Rating Calculator for Music Battle
  K-factor of 32: responsive but not too volatile
*/

function calculateElo(winnerRating, loserRating, kFactor) {
    if (kFactor === undefined) kFactor = 32;

    var expectedWin = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
    var expectedLose = 1 - expectedWin;

    return {
        newWinnerRating: Math.round(winnerRating + kFactor * (1 - expectedWin)),
        newLoserRating: Math.round(loserRating + kFactor * (0 - expectedLose))
    };
}

module.exports = { calculateElo };
