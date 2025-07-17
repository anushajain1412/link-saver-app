import React, { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import './Dashboard.css'; // Ensure this CSS file exists and is linked

// Define your deployed backend URL here
const BACKEND_BASE_URL = 'https://link-saver-api-1coe.onrender.com';

function Dashboard({ onLogout }) {
    const [urlInput, setUrlInput] = useState('');
    const [tagInput, setTagInput] = useState(''); // State for the tag input field
    const [links, setLinks] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true); // Loading state for initial fetch
    const [savingLink, setSavingLink] = useState(false); // Loading state for saving new link
    const [filterTag, setFilterTag] = useState(''); // For Tag filter dropdown
    const [allTags, setAllTags] = useState([]); // To populate filter dropdown

    // Effect to fetch links when the component mounts
    useEffect(() => {
        fetchLinks();
    }, []);

    // Effect to extract unique tags whenever the links state changes
    useEffect(() => {
        const tags = new Set();
        links.forEach(link => {
            // Ensure link.tags exists and is an array before iterating
            if (link.tags && Array.isArray(link.tags)) {
                link.tags.forEach(tag => tags.add(tag));
            }
        });
        setAllTags(Array.from(tags).sort()); // Convert Set to Array and sort alphabetically
    }, [links]); // Re-run when 'links' state changes

    /**
     * Fetches links from the backend for the authenticated user.
     */
    const fetchLinks = async () => {
        setLoading(true); // Set loading true before fetch
        setError(''); // Clear any previous errors
        try {
            const token = localStorage.getItem('token');
            if (!token) {
                setError("No authentication token found. Please log in.");
                onLogout(); // Force logout if no token
                return;
            }

            const response = await fetch(`${BACKEND_BASE_URL}/api/links`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });

            if (!response.ok) {
                // If token is invalid/expired, backend will return 403, so force logout
                if (response.status === 403 || response.status === 401) {
                    onLogout();
                    return;
                }
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to fetch links.');
            }

            const data = await response.json();
            setLinks(data); // Update links state with fetched data
        } catch (err) {
            console.error("Fetch links error:", err);
            setError(err.message);
        } finally {
            setLoading(false); // Set loading false after fetch
        }
    };

    /**
     * Handles saving a new link by sending the URL and tags to the backend.
     * @param {Event} e - The form submission event.
     */
    const handleSaveLink = async (e) => {
        e.preventDefault(); // Prevent default form submission
        setError(''); // Clear previous errors
        setSavingLink(true); // Set saving link loading state

        if (!urlInput) {
            setError('URL cannot be empty.');
            setSavingLink(false);
            return;
        }

        // Frontend URL validation: Ensure URL starts with http:// or https://
        const urlRegex = /^(https?:\/\/[^\s$.?#].[^\s]*)$/i;
        if (!urlRegex.test(urlInput)) {
            setError('Please enter a valid URL starting with http:// or https://');
            setSavingLink(false);
            return;
        }

        // Process tag input: Split by comma, trim whitespace, and filter out empty strings
        const processedTags = tagInput
            .split(',')
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0);

        try {
            const token = localStorage.getItem('token');
            if (!token) {
                setError("No authentication token found. Please log in.");
                onLogout();
                return;
            }

            const response = await fetch(`${BACKEND_BASE_URL}/api/links`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ url: urlInput, tags: processedTags }), // Send URL and processed tags
            });

            if (!response.ok) {
                 if (response.status === 403 || response.status === 401) {
                    onLogout();
                    return;
                }
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to save link.');
            }

            const newLink = await response.json();
            // Optimistically add the new link to the state
            setLinks((prevLinks) => [...prevLinks, newLink]);
            setUrlInput(''); // Clear URL input field
            setTagInput(''); // Clear tag input field
        } catch (err) {
            console.error("Save link error:", err);
            setError(err.message);
        } finally {
            setSavingLink(false); // Reset saving link loading state
        }
    };

    /**
     * Handles deleting a link by its ID.
     * @param {number} id - The ID of the link to delete.
     */
    const handleDelete = async (id) => {
        setError(''); // Clear previous errors
        // Using window.confirm as a placeholder for a custom modal confirmation
        if (window.confirm('Are you sure you want to delete this link?')) {
            try {
                const token = localStorage.getItem('token');
                if (!token) {
                    setError("No authentication token found. Please log in.");
                    onLogout();
                    return;
                }

                const response = await fetch(`${BACKEND_BASE_URL}/api/links/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` },
                });

                if (!response.ok) {
                     if (response.status === 403 || response.status === 401) {
                        onLogout();
                        return;
                    }
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Failed to delete link.');
                }

                // Filter out the deleted link from the state
                setLinks((prevLinks) => prevLinks.filter((link) => link.id !== id));
            } catch (err) {
                console.error("Delete link error:", err);
                setError(err.message);
            }
        }
    };

    /**
     * Handles the end of a drag-and-drop operation to reorder links.
     * @param {object} result - The result object from DragDropContext.
     */
    const onDragEnd = async (result) => {
        // If no destination or dropped outside a droppable area, do nothing
        if (!result.destination) return;

        const items = Array.from(links); // Create a mutable copy of the links array
        const [reorderedItem] = items.splice(result.source.index, 1); // Remove item from its source position
        items.splice(result.destination.index, 0, reorderedItem); // Insert item at its new destination

        setLinks(items); // Optimistically update the UI

        // Update order on the backend
        try {
            const token = localStorage.getItem('token');
            if (!token) {
                setError("No authentication token found. Please log in.");
                onLogout();
                return;
            }

            const orderedLinkIds = items.map(link => link.id); // Get the new order of link IDs
            await fetch(`${BACKEND_BASE_URL}/api/links/reorder`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ orderedLinkIds }), // Send new order to backend
            });
        } catch (err) {
            console.error("Failed to update link order on backend:", err);
            setError("Failed to save new order. Please refresh to sync.");
            fetchLinks(); // Re-fetch to sync with backend if optimistic update failed
        }
    };

    // Filter links based on the selected tag
    const filteredLinks = filterTag
        ? links.filter(link => link.tags && link.tags.includes(filterTag))
        : links;

    return (
        <div className="dashboard-container">
            <header className="dashboard-header">
                <h1>Link Saver</h1>
                <button onClick={onLogout} className="logout-button">Logout</button>
            </header>

            <div className="add-link-section">
                <form onSubmit={handleSaveLink}>
                    <input
                        type="url"
                        placeholder="Paste URL here..."
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        required
                        aria-label="URL input"
                    />
                    {/* New input for tags */}
                    <input
                        type="text"
                        placeholder="Add tags (comma-separated, e.g., tech, news)"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        aria-label="Tags input"
                    />
                    <button type="submit" disabled={savingLink}>
                        {savingLink ? 'Saving...' : 'Save Link'}
                    </button>
                </form>
                {error && <p className="error-message">{error}</p>}
            </div>

            <div className="filter-section">
                <label htmlFor="tag-filter">Filter by Tag: </label>
                <select
                    id="tag-filter"
                    value={filterTag}
                    onChange={(e) => setFilterTag(e.target.value)}
                    aria-label="Filter links by tag"
                >
                    <option value="">All Tags</option>
                    {/* Render options for each unique tag */}
                    {allTags.map(tag => (
                        <option key={tag} value={tag}>{tag}</option>
                    ))}
                </select>
            </div>

            {loading ? (
                <p>Loading links...</p>
            ) : (
                <DragDropContext onDragEnd={onDragEnd}>
                    <Droppable droppableId="links">
                        {(provided) => (
                            <div
                                className="links-grid"
                                {...provided.droppableProps}
                                ref={provided.innerRef}
                            >
                                {filteredLinks.length === 0 ? (
                                    <p className="no-links-message">No links saved yet. Add one above!</p>
                                ) : (
                                    filteredLinks.map((link, index) => (
                                        <Draggable key={link.id} draggableId={String(link.id)} index={index}>
                                            {(provided) => (
                                                <div
                                                    className="link-card"
                                                    ref={provided.innerRef}
                                                    {...provided.draggableProps}
                                                    {...provided.dragHandleProps}
                                                >
                                                    <div className="link-header">
                                                        {link.favicon && (
                                                            <img
                                                                src={link.favicon}
                                                                alt="Favicon"
                                                                className="link-favicon"
                                                                onError={(e) => { e.target.style.display = 'none'; }}
                                                            />
                                                        )}
                                                        <h3 className="link-title">{link.title || link.url}</h3>
                                                    </div>
                                                    <p className="link-summary">{link.summary}</p>
                                                    <div className="link-actions">
                                                        <a href={link.url} target="_blank" rel="noopener noreferrer" className="view-button">View</a>
                                                        <button onClick={() => handleDelete(link.id)} className="delete-button">Delete</button>
                                                    </div>
                                                    {link.tags && link.tags.length > 0 && (
                                                        <div className="link-tags">
                                                            {link.tags.map(tag => <span key={tag} className="tag">{tag}</span>)}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </Draggable>
                                    ))
                                )}
                                {provided.placeholder}
                            </div>
                        )}
                    </Droppable>
                </DragDropContext>
            )}
        </div>
    );
}

export default Dashboard;
