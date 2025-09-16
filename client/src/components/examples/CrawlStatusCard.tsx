import CrawlStatusCard from '../CrawlStatusCard';

export default function CrawlStatusCardExample() {
  //todo: remove mock functionality
  const mockCrawlStatus = {
    id: '1',
    url: 'https://example.com',
    status: 'crawling' as const,
    progress: 65,
    pagesFound: 24,
    pagesIndexed: 18,
    lastCrawled: new Date('2024-01-15T10:30:00'),
    nextCrawl: new Date('2024-01-16T10:30:00')
  };

  const handleStart = (id: string) => {
    console.log('Start crawl:', id);
  };

  const handleStop = (id: string) => {
    console.log('Stop crawl:', id);
  };

  const handleRetry = (id: string) => {
    console.log('Retry crawl:', id);
  };

  return (
    <div className="max-w-md">
      <CrawlStatusCard 
        crawlStatus={mockCrawlStatus}
        onStart={handleStart}
        onStop={handleStop}
        onRetry={handleRetry}
      />
    </div>
  );
}