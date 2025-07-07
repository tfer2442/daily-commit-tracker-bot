const { WebhookClient, EmbedBuilder } = require('discord.js');
const axios = require('axios');

// 설정값들 - GitHub Secrets에서 가져옴
const CONFIG = {
    DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL,
    GITHUB_REPOS: process.env.REPOS,
    TARGET_COMMITS: 3 // 목표 문제 수
};

// 한국시간 기준 날짜 가져오기
function getKoreaDate(date = new Date()) {
    const koreaOffset = 9 * 60 * 60 * 1000;
    return new Date(date.getTime() + koreaOffset);
}

// 특정 날짜의 커밋 정보 가져오기
async function getDayCommits(owner, repo, targetDate) {
    try {
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);
        
        const koreaOffset = 9 * 60 * 60 * 1000;
        const since = new Date(startOfDay.getTime() - koreaOffset).toISOString();
        const until = new Date(endOfDay.getTime() - koreaOffset).toISOString();
        
        const response = await axios.get(
            `https://api.github.com/repos/${owner}/${repo}/commits`,
            {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'GitHub-Actions-Bot'
                },
                params: { since, until, per_page: 50 }
            }
        );
        
        return {
            owner, repo,
            date: targetDate.toLocaleDateString('ko-KR'),
            commits: response.data
        };
    } catch (error) {
        return {
            owner, repo,
            date: targetDate.toLocaleDateString('ko-KR'),
            commits: [],
            error: error.message
        };
    }
}

// 이번주 평일(월~금) 모든 커밋 가져오기
async function getWeeklyCommits(owner, repo) {
    const results = [];
    const koreaToday = getKoreaDate();
    
    const monday = new Date(koreaToday);
    monday.setDate(monday.getDate() - monday.getDay() + 1);
    
    for (let i = 0; i < 5; i++) {
        const targetDate = new Date(monday);
        targetDate.setDate(monday.getDate() + i);
        
        if (targetDate > koreaToday) continue;
        
        const dayResult = await getDayCommits(owner, repo, targetDate);
        results.push(dayResult);
        
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    return results;
}

// 어제(평일만) 커밋 정보 가져오기
async function getYesterdayCommits() {
    const koreaToday = getKoreaDate();
    const yesterday = new Date(koreaToday);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const dayOfWeek = yesterday.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        return [];
    }
    
    const repoList = CONFIG.GITHUB_REPOS.split(',').map(repo => repo.trim());
    const results = [];
    
    for (const repoString of repoList) {
        const [owner, repo] = repoString.split('/');
        if (owner && repo) {
            const result = await getDayCommits(owner, repo, yesterday);
            results.push(result);
        }
    }
    
    return results;
}

// 일일 커밋 리포트 Embed 생성
function createDailyCommitEmbed(repoData) {
    const { owner, repo, date, commits, error } = repoData;
    const solvedCount = commits.length;
    const isSuccess = solvedCount >= CONFIG.TARGET_COMMITS;
    
    const embed = new EmbedBuilder()
        .setTitle(`🧮 ${owner}/${repo} - ${date} 알고리즘 문제 풀이`)
        .setColor(isSuccess ? 0x00D084 : 0xFF6B6B)
        .setTimestamp()
        .setURL(`https://github.com/${owner}/${repo}`)
        .setFooter({ 
            text: `총 ${solvedCount}문제 해결`,
            iconURL: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'
        });
    
    const statusEmoji = isSuccess ? '✅' : '❌';
    embed.setDescription(`${statusEmoji} **${solvedCount}/${CONFIG.TARGET_COMMITS}**`);
    
    if (error) {
        embed.setColor(0xFF0000);
        embed.setDescription(`❌ 레포지토리 정보를 가져오는데 실패했습니다.\n오류: ${error}`);
        return embed;
    }
    
    if (solvedCount === 0) {
        embed.addFields({
            name: '😴 문제 풀이 없음',
            value: `${date}에는 알고리즘 문제를 풀지 않았습니다.`,
            inline: false
        });
        return embed;
    }
    
    commits.slice(0, 10).forEach((commit, index) => {
        const message = commit.commit.message.split('\n')[0];
        const shortSha = commit.sha.substring(0, 7);
        const commitUrl = commit.html_url;
        
        const commitTime = new Date(commit.commit.author.date).toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Asia/Seoul'
        });
        
        embed.addFields({
            name: `${commitTime}`,
            value: `[\`${shortSha}\`](${commitUrl}) ${message}`,
            inline: false
        });
    });
    
    if (solvedCount > 10) {
        embed.addFields({
            name: '📋 더 많은 문제',
            value: `${solvedCount - 10}개의 추가 문제를 더 풀었습니다.`,
            inline: false
        });
    }
    
    return embed;
}

// 주간 요약 Embed 생성
function createWeeklyCommitEmbed(repoData, weeklyResults) {
    const { owner, repo } = repoData;
    const totalSolved = weeklyResults.reduce((sum, day) => sum + day.commits.length, 0);
    
    const successDays = weeklyResults.filter(day => day.commits.length >= CONFIG.TARGET_COMMITS).length;
    const totalDays = weeklyResults.length;
    
    const embed = new EmbedBuilder()
        .setTitle(`📈 ${owner}/${repo} - 이번주 알고리즘 문제 풀이 요약`)
        .setColor(successDays === totalDays ? 0x00D084 : 0xFFB84D)
        .setTimestamp()
        .setURL(`https://github.com/${owner}/${repo}`)
        .setDescription(`이번주 **총 ${totalSolved}문제**를 해결했습니다! 🎉`)
        .setFooter({ 
            text: `목표 달성: ${successDays}/${totalDays}일`,
            iconURL: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'
        });
    
    const dayNames = ['월', '화', '수', '목', '금'];
    weeklyResults.forEach((dayData, index) => {
        const dayName = dayNames[index];
        const solvedCount = dayData.commits.length;
        const isSuccess = solvedCount >= CONFIG.TARGET_COMMITS;
        const emoji = isSuccess ? '✅' : '❌';
        
        embed.addFields({
            name: `${emoji} ${dayName}요일`,
            value: `${solvedCount}/${CONFIG.TARGET_COMMITS}`,
            inline: true
        });
    });
    
    return embed;
}

// 메인 실행 함수
// 메인 실행 함수 수정
async function main() {
    try {
        const koreaToday = getKoreaDate();
        const todayDay = koreaToday.getDay();
        
        if (todayDay === 0) {
            console.log('일요일은 휴식!');
            return;
        }
        
        const webhookClient = new WebhookClient({ url: CONFIG.DISCORD_WEBHOOK_URL });
        const repoList = CONFIG.GITHUB_REPOS.split(',').map(repo => repo.trim());
        
        if (todayDay === 6) {
            // 토요일: 금요일 일일 리포트 + 주간 요약
            
            // 1. 먼저 금요일 일일 리포트
            const yesterdayResults = await getYesterdayCommits();
            
            for (const repoData of yesterdayResults) {
                const embed = createDailyCommitEmbed(repoData);
                await webhookClient.send({ embeds: [embed] });
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // 2. 그 다음 주간 요약
            for (const repoString of repoList) {
                const [owner, repo] = repoString.split('/');
                if (owner && repo) {
                    const weeklyResults = await getWeeklyCommits(owner, repo);
                    const embed = createWeeklyCommitEmbed({ owner, repo }, weeklyResults);
                    
                    await webhookClient.send({ embeds: [embed] });
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        } else {
            // 화~금: 일일 리포트만
            const yesterdayResults = await getYesterdayCommits();
            
            if (yesterdayResults.length === 0) {
                return;
            }
            
            for (const repoData of yesterdayResults) {
                const embed = createDailyCommitEmbed(repoData);
                await webhookClient.send({ embeds: [embed] });
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
    } catch (error) {
        console.error('오류 발생:', error);
    }
}

main();