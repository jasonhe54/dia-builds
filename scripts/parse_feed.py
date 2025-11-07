#!/usr/bin/env python3

import sys
import json
import xml.etree.ElementTree as ET

def parse_sparkle_feed(xml_file):
    """
    Parses a Sparkle XML feed and prints a JSON array of release items.
    
    This parser is designed to handle the specific (and unusual) namespace
    declarations found in the user's feed, such as xmlns="xmlns".
    """
    
    # Define the namespaces we need to search for.
    # 'rss' is our alias for the weird "xmlns" default namespace.
    # 'sparkle' is the standard Sparkle namespace.
    namespaces = {
        'rss': 'xmlns',
        'sparkle': 'http://www.andymatuschak.org/xml-namespaces/sparkle'
    }

    try:
        tree = ET.parse(xml_file)
        root = tree.getroot()
        
        items = []
        
        # Find all <item> tags (which are in the 'rss' namespace)
        for item in root.findall('.//rss:item', namespaces):
            
            # Find sparkle:version (in the 'sparkle' namespace)
            version_elem = item.find('sparkle:version', namespaces)
            version = version_elem.text if version_elem is not None else ''

            # Find sparkle:shortVersionString (in the 'sparkle' namespace)
            short_version_elem = item.find('sparkle:shortVersionString', namespaces)
            short_version = short_version_elem.text if short_version_elem is not None else ''

            # Find description (in the 'rss' namespace)
            desc_elem = item.find('rss:description', namespaces)
            description = desc_elem.text if desc_elem is not None else ''

            # Find the main enclosure. This is the one in the 'rss' namespace
            # that does NOT have a 'sparkle:deltaFrom' attribute.
            zip_url = ''
            
            # Attributes with namespaces are formatted as: {namespace_uri}local_name
            delta_attr_key = f"{{{namespaces['sparkle']}}}deltaFrom"
            
            for enclosure in item.findall('rss:enclosure', namespaces):
                if delta_attr_key not in enclosure.attrib:
                    # This is not a delta. Get its 'url' attribute.
                    zip_url = enclosure.attrib.get('url', '')
                    break  # Found the main download, stop looking in this item

            # Only add the item if we found all the key pieces
            if version and short_version and zip_url:
                items.append({
                    'build_num': version.strip(),
                    'short_version_str': short_version.strip(),
                    'description': description.strip(),
                    'zip_url': zip_url
                })

        # Print the final list as a compact JSON string to stdout.
        # This is what GitHub Actions will capture.
        print(json.dumps(items, separators=(',', ':')))

    except ET.ParseError as e:
        print(f"Error parsing XML: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"An unexpected error occurred: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python parse_feed.py <path_to_feed.xml>", file=sys.stderr)
        sys.exit(1)
    
    parse_sparkle_feed(sys.argv[1])