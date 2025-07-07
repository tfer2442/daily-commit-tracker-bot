const { WebhookClient, EmbedBuilder } = require('discord.js');
const axios = require('axios');

// 설정값들 - GitHub Secrets에서 가져옴
const CONFIG = {
    DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL,
    GITHUB_REPOS: process.env.REPOS,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN, // 추가: API rate limit 방지
    TARGET_COMMITS: 3 // 목표 문제 수
};

// UTC 기준으로 한국 시간 날짜 가져오기 (GitHub Actions 환경용)
function getKoreaDateFromUTC() {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const koreaTime = new Date(utc + (9 * 60 * 60 * 1000));
    return koreaTime;
}

// 특정 날짜의 커밋 정보 가져오기
async function getDayCommits(owner, repo, targetDate) {
    try {
        // 한국 시간 기준 하루의 시작과 끝
        const year = targetDate.getFullYear();
        const month = targetDate.getMonth();
        const date = targetDate.getDate();
        
        // UTC로 변환 (한국시간 00:00 = UTC 전날 15:00)
        const startKST = new Date(year, month, date, 0, 0, 0);
        const endKST = new Date(year, month, date, 23, 59, 59);
        
        const startUTC = new Date(startKST.getTime() - (9 * 60 * 60 * 1000));
        const endUTC = new Date(endKST.getTime() - (9 * 60 * 60 * 1000));
        
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'GitHub-Actions-Bot'
        };
        
        // GitHub 토큰이 있으면 추가
        if (CONFIG.GITHUB_TOKEN) {
            headers['Authorization'] = `token ${CONFIG.GITHUB_TOKEN}`;
        }
        
        const response = await axios.get(
            `https://api.github.com/repos/${owner}/${repo}/commits`,
            {
                headers,
                params: { 
                    since: startUTC.toISOString(),
                    until: endUTC.toISOString(),
                    per_page: 50 
                }
            }
        );
        
        return {
            owner, repo,
            date: `${year}. ${month + 1}. ${date}.`,
            commits: response.data
        };
    } catch (error) {
        console.error(`Error fetching commits for ${owner}/${repo}:`, error.message);
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
    const koreaToday = getKoreaDateFromUTC();
    
    // 이번 주 월요일 찾기
    const monday = new Date(koreaToday);
    const day = monday.getDay();
    const diff = day === 0 ? -6 : 1 - day; // 일요일인 경우 지난주 월요일
    monday.setDate(monday.getDate() + diff);
    
    for (let i = 0; i < 5; i++) {
        const targetDate = new Date(monday);
        targetDate.setDate(monday.getDate() + i);
        
        // 미래 날짜는 건너뛰기
        if (targetDate > koreaToday) continue;
        
        const dayResult = await getDayCommits(owner, repo, targetDate);
        results.push(dayResult);
        
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    return results;
}

// 특정 날짜의 커밋 정보 가져오기 (토요일 전용)
async function getSpecificDayCommits(date) {
    const repoList = CONFIG.GITHUB_REPOS.split(',').map(repo => repo.trim());
    const results = [];
    
    for (const repoString of repoList) {
        const [owner, repo] = repoString.split('/');
        if (owner && repo) {
            const result = await getDayCommits(owner, repo, date);
            results.push(result);
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }
    
    return results;
}

// 어제(평일만) 커밋 정보 가져오기
async function getYesterdayCommits() {
    const koreaToday = getKoreaDateFromUTC();
    const yesterday = new Date(koreaToday);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const dayOfWeek = yesterday.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        return [];
    }
    
    return await getSpecificDayCommits(yesterday);
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
        
        const commitTime = new Date(commit.commit.author.date);
        const koreaTime = new Date(commitTime.getTime() + (9 * 60 * 60 * 1000));
        const timeString = `${koreaTime.getHours().toString().padStart(2, '0')}:${koreaTime.getMinutes().toString().padStart(2, '0')}`;
        
        embed.addFields({
            name: `${timeString}`,
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
async function main() {
    try {
        const koreaToday = getKoreaDateFromUTC();
        const todayDay = koreaToday.getDay();
        
        console.log(`실행 시각 (한국): ${koreaToday.toLocaleString('ko-KR')}`);
        console.log(`오늘 요일: ${['일', '월', '화', '수', '목', '금', '토'][todayDay]}요일`);
        
        if (todayDay === 0) {
            console.log('일요일은 휴식!');
            return;
        }
        
        if (!CONFIG.DISCORD_WEBHOOK_URL) {
            console.error('DISCORD_WEBHOOK_URL이 설정되지 않았습니다.');
            return;
        }
        
        const webhookClient = new WebhookClient({ url: CONFIG.DISCORD_WEBHOOK_URL });
        const repoList = CONFIG.GITHUB_REPOS.split(',').map(repo => repo.trim());
        
        if (todayDay === 6) {
            // 토요일: 금요일 일일 리포트 + 주간 요약
            console.log('토요일 실행: 금요일 리포트 + 주간 요약');
            
            // 1. 금요일 날짜 계산
            const friday = new Date(koreaToday);
            friday.setDate(friday.getDate() - 1); // 어제 = 금요일
            
            const fridayResults = await getSpecificDayCommits(friday);
            
            for (const repoData of fridayResults) {
                const embed = createDailyCommitEmbed(repoData);
                await webhookClient.send({ embeds: [embed] });
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // 2. 주간 요약
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
            console.log('평일 실행: 어제 리포트');
            const yesterdayResults = await getYesterdayCommits();
            
            if (yesterdayResults.length === 0) {
                console.log('체크할 커밋이 없습니다.');
                return;
            }
            
            for (const repoData of yesterdayResults) {
                const embed = createDailyCommitEmbed(repoData);
                await webhookClient.send({ embeds: [embed] });
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        console.log('알림 전송 완료!');
        
    } catch (error) {
        console.error('오류 발생:', error);
        // Discord 웹훅이 설정되어 있다면 오류 알림도 전송
        if (CONFIG.DISCORD_WEBHOOK_URL) {
            try {
                const webhookClient = new WebhookClient({ url: CONFIG.DISCORD_WEBHOOK_URL });
                const errorEmbed = new EmbedBuilder()
                    .setTitle('❌ 알고리즘 봇 오류')
                    .setColor(0xFF0000)
                    .setDescription(`\`\`\`${error.message}\`\`\``)
                    .setTimestamp();
                await webhookClient.send({ embeds: [errorEmbed] });
            } catch (webhookError) {
                console.error('오류 알림 전송 실패:', webhookError);
            }
        }
    }
}

main();