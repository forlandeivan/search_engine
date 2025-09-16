import SearchResult from '../SearchResult';

export default function SearchResultExample() {
  //todo: remove mock functionality
  const mockResult = {
    id: '1',
    title: 'DateTime',
    description: 'Работа со временем, датами и планировщиком',
    url: 'https://example.com/datetime',
    lastCrawled: new Date('2024-01-15'),
    isFavorite: true
  };

  const handleToggleFavorite = (id: string) => {
    console.log('Toggle favorite:', id);
  };

  const handleRemove = (id: string) => {
    console.log('Remove result:', id);
  };

  return (
    <SearchResult 
      result={mockResult}
      onToggleFavorite={handleToggleFavorite}
      onRemove={handleRemove}
      searchQuery="время"
    />
  );
}