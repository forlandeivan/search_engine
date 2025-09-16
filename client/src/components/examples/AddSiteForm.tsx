import AddSiteForm from '../AddSiteForm';

export default function AddSiteFormExample() {
  const handleSubmit = (config: any) => {
    console.log('Site config submitted:', config);
  };

  const handleCancel = () => {
    console.log('Form cancelled');
  };

  return (
    <div className="max-w-2xl">
      <AddSiteForm onSubmit={handleSubmit} onCancel={handleCancel} />
    </div>
  );
}