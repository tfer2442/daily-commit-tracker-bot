const { WebhookClient, EmbedBuilder } = require('discord.js');
const axios = require('axios');

// 설정값들 - GitHub Secrets에서 가져옴
const CONFIG = {
    DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL, // Discord 웹훅 URL
    // 여러 레포지토리 설정 (쉼표로 구분)
    GITHUB_REPOS: process.env.GITHUB_REPOS
};

// GitHub API를 통해 특정 레포지토리의 어제 커밋 정보 가져오기
async function getYesterdayCommits(owner, repo) {
    try {
        // 어제 날짜 계산 (전 날 00:00:00 ~ 23:59:59)
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const since = yesterday.toISOString();
        const until = today.toISOString();
        
        console.log(`📅 ${owner}/${repo} - 검색 기간: ${since.split('T')[0]} ~ ${until.split('T')[0]}`);
        
        const response = await axios.get(
            `https://api.github.com/repos/${owner}/${repo}/commits`,
            {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'GitHub-Actions-Bot'
                },
                params: { 
                    since: since, 
                    until: until, 
                    per_page: 20 
                }
            }
        );
        
        return {
            owner,
            repo,
            commits: response.data,
            searchDate: yesterday.toLocaleDateString('ko-KR')
        };
    } catch (error) {
        console.error(`❌ ${owner}/${repo} GitHub API 오류:`, error.message);
        return {
            owner,
            repo,
            commits: [],
            error: error.message,
            searchDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleDateString('ko-KR')
        };
    }
}

// 모든 레포지토리의 어제 커밋 정보 가져오기
async function getAllRepositoryCommits() {
    const repoList = CONFIG.GITHUB_REPOS.split(',').map(repo => repo.trim());
    const results = [];
    
    console.log(`🔍 총 ${repoList.length}개 레포지토리에서 어제 커밋 정보 수집 중...`);
    
    for (const repoString of repoList) {
        const [owner, repo] = repoString.split('/');
        if (owner && repo) {
            console.log(`📁 ${owner}/${repo} 커밋 정보 수집 중...`);
            const result = await getYesterdayCommits(owner, repo);
            results.push(result);
            
            // API 제한을 피하기 위해 잠시 대기
            await new Promise(resolve => setTimeout(resolve, 500));
        } else {
            console.error(`❌ 잘못된 레포지토리 형식: ${repoString}`);
        }
    }
    
    return results;
}

// 레포지토리별 커밋 정보를 Discord Embed로 변환
function createCommitEmbed(repoData) {
    const { owner, repo, commits, error, searchDate } = repoData;
    
    const embed = new EmbedBuilder()
        .setTitle(`📊 ${owner}/${repo} - ${searchDate} 커밋 리포트`)
        .setColor(0x00D084)
        .setTimestamp()
        .setURL(`https://github.com/${owner}/${repo}`)
        .setFooter({ 
            text: `총 ${commits.length}개의 커밋`,
            iconURL: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png'
        });
    
    // 에러가 있는 경우
    if (error) {
        embed.setColor(0xFF0000);
        embed.setDescription(`❌ 레포지토리 정보를 가져오는데 실패했습니다.\n오류: ${error}`);
        return embed;
    }
    
    // 커밋이 없는 경우
    if (commits.length === 0) {
        embed.setDescription(`${searchDate}에는 커밋이 없었습니다. 😴`);
        embed.setColor(0x808080); // 회색으로 변경
        return embed;
    }
    
    // 커밋이 있는 경우 - 최대 10개까지 표시
    commits.slice(0, 10).forEach((commit, index) => {
        const message = commit.commit.message.split('\n')[0]; // 첫 번째 줄만
        const shortSha = commit.sha.substring(0, 7);
        const commitUrl = commit.html_url;
        const commitTime = new Date(commit.commit.author.date).toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        embed.addFields({
            name: `${commitTime}`,
            value: `[\`${shortSha}\`](${commitUrl}) ${message}`,
            inline: false
        });
    });
    
    // 더 많은 커밋이 있는 경우
    if (commits.length > 10) {
        embed.addFields({
            name: '📋 더 많은 커밋',
            value: `${commits.length - 10}개의 추가 커밋이 있습니다. [전체 보기](https://github.com/${owner}/${repo}/commits)`,
            inline: false
        });
    }
    
    return embed;
}

// 메인 실행 함수
async function main() {
    try {
        console.log('🚀 GitHub 커밋 알림 봇 시작...');
        console.log(`📋 모니터링 레포지토리: ${CONFIG.GITHUB_REPOS}`);
        console.log(`⏰ 실행 시간: ${new Date().toLocaleString('ko-KR')}`);
        
        // 모든 레포지토리의 어제 커밋 정보 수집
        const allRepoData = await getAllRepositoryCommits();
        const webhookClient = new WebhookClient({ url: CONFIG.DISCORD_WEBHOOK_URL });
        
        // 각 레포지토리별로 커밋 embed 전송
        for (const repoData of allRepoData) {
            const embed = createCommitEmbed(repoData);
            await webhookClient.send({ embeds: [embed] });
            console.log(`✅ ${repoData.owner}/${repoData.repo}: ${repoData.commits.length}개 커밋 리포트 전송 완료`);
            
            // Discord API 제한을 피하기 위해 잠시 대기
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        const totalCommits = allRepoData.reduce((sum, repo) => sum + repo.commits.length, 0);
        console.log(`🎉 모든 리포트 전송 완료! 총 ${totalCommits}개 커밋`);
        
    } catch (error) {
        console.error('❌ 치명적 오류 발생:', error);
        
        // 오류 발생 시 Discord로 오류 알림 전송
        try {
            const webhookClient = new WebhookClient({ url: CONFIG.DISCORD_WEBHOOK_URL });
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ 커밋 알림 봇 오류 발생')
                .setColor(0xFF0000)
                .setDescription(`오류가 발생했습니다: ${error.message}`)
                .setTimestamp();
            
            await webhookClient.send({ embeds: [errorEmbed] });
        } catch (discordError) {
            console.error('Discord 오류 알림 전송 실패:', discordError);
        }
        
        process.exit(1);
    }
}

// 실행
main();