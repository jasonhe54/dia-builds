#!/usr/bin/env python3

import sys
import json
from lxml import etree as ET

def parse_sparkle_feed(xml_file):
    """
    Parses a Sparkle XML feed using lxml's recovery mode
    to handle malformed XML.
    """
    
    # Define the Sparkle namespace
    namespaces = {
        'sparkle': 'http://www.andymatuschak.org/xml-namespaces/sparkle'
    }

    try:
        # Create a parser that will attempt to recover from errors
        parser = ET.XMLParser(recover=True)
        
        # Parse the file using the recovery-mode parser
        with open(xml_file, 'rb') as f:
            tree = ET.parse(f, parser=parser)
        
        root = tree.getroot()
        items = []
        
        # Find all <item> tags (no namespace)
        for item in root.findall('.//item'):
            
            # Try to find version with sparkle namespace first, then check for xmlns attribute
            version_elem = item.find('sparkle:version', namespaces)
            if version_elem is None:
                # Look for version element with xmlns attribute
                for elem in item.findall('version'):
                    version_elem = elem
                    break
            version = version_elem.text if version_elem is not None else ''

            # Try to find shortVersionString with sparkle namespace first
            short_version_elem = item.find('sparkle:shortVersionString', namespaces)
            if short_version_elem is None:
                # Look for shortVersionString element with xmlns attribute
                for elem in item.findall('shortVersionString'):
                    short_version_elem = elem
                    break
            short_version = short_version_elem.text if short_version_elem is not None else ''

            # Description has no namespace
            desc_elem = item.find('description')
            description = desc_elem.text if desc_elem is not None else ''

            # Find the main enclosure (not a delta)
            zip_url = ''
            delta_attr = f"{{{namespaces['sparkle']}}}deltaFrom"
            
            # Find enclosure tags (no namespace)
            for enclosure in item.findall('enclosure'):
                # Skip if it has the deltaFrom attribute
                if delta_attr not in enclosure.attrib:
                    zip_url = enclosure.attrib.get('url', '')
                    break 

            if version and short_version and zip_url:
                # Extract just the filename from the URL
                zip_filename = zip_url.split('/')[-1] if '/' in zip_url else zip_url
                
                items.append({
                    'build_num': version.strip(),
                    'short_version_str': short_version.strip(),
                    'description': description.strip(),
                    'zip_url': zip_url,
                    'zip_filename': zip_filename
                })

        print(json.dumps(items, separators=(',', ':')))

    except Exception as e:
        print(f"An unexpected error occurred during lxml parsing: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python parse_feed.py <path_to_feed.xml>", file=sys.stderr)
        sys.exit(1)
    
    parse_sparkle_feed(sys.argv[1])