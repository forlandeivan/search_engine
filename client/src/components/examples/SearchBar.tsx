import SearchBar from '../SearchBar';

export default function SearchBarExample() {
  const handleSearch = (query: string) => {
    console.log('Search triggered:', query);
  };

  return <SearchBar onSearch={handleSearch} />;
}